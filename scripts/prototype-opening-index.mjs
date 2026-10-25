// OT-03 disposable storage experiment, intentionally not a ready runtime file.
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { parsePgn, startingPosition } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { readSourceTree, normalizeAnnotations, generateViewerPgn, SOURCE_TREE_VERSION } from '../lib/opening-source-tree.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: prototype-opening-index.mjs data/slice.json data/new-index.sqlite3');
const destination = resolve(output), local = relative(resolve('data'), destination);
if (local.startsWith('..') || isAbsolute(local) || existsSync(destination) || existsSync(destination + '.report.json'))
  throw new Error('Choose a new output under ignored data/');
const source = JSON.parse(readFileSync(input, 'utf8'));
const db = new Database(destination);
db.pragma('foreign_keys=ON');
// Each document remains an atomic checkpoint. WAL avoids DELETE-journal
// filesystem synchronization dominating small documents on Windows.
db.pragma('journal_mode=WAL');
db.pragma('synchronous=FULL');
db.exec(`
  CREATE TABLE documents(id INTEGER PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, tree_hash TEXT NOT NULL);
  CREATE TABLE positions(id INTEGER PRIMARY KEY, hash INTEGER NOT NULL, exact_key TEXT NOT NULL, UNIQUE(hash,exact_key));
  CREATE TABLE prefixes(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES prefixes(id), move TEXT, position_id INTEGER NOT NULL REFERENCES positions(id));
  CREATE UNIQUE INDEX prefix_children ON prefixes(parent_id,move) WHERE parent_id IS NOT NULL;
  CREATE UNIQUE INDEX prefix_roots ON prefixes(position_id) WHERE parent_id IS NULL;
  CREATE TABLE nodes(id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id),
    parent_id INTEGER REFERENCES nodes(id), ordinal INTEGER NOT NULL, source_index INTEGER NOT NULL,
    source_path TEXT NOT NULL, viewer_path TEXT NOT NULL, prefix_id INTEGER NOT NULL REFERENCES prefixes(id),
    position_id INTEGER NOT NULL REFERENCES positions(id), uci TEXT, san TEXT, mainline INTEGER NOT NULL,
    leaf_lo INTEGER NOT NULL, leaf_hi INTEGER NOT NULL, UNIQUE(document_id,source_path));
  CREATE INDEX node_prefix ON nodes(prefix_id,document_id,leaf_lo,leaf_hi);
  CREATE INDEX node_position ON nodes(position_id,document_id,id);
  CREATE INDEX node_children ON nodes(parent_id,uci,document_id,id);
  CREATE INDEX node_order ON nodes(parent_id,ordinal);
  CREATE TABLE annotations(id INTEGER PRIMARY KEY, document_id INTEGER REFERENCES documents(id), node_id INTEGER REFERENCES nodes(id),
    sequence INTEGER NOT NULL, language TEXT, type TEXT NOT NULL, status TEXT NOT NULL,
    payload_json TEXT NOT NULL, UNIQUE(document_id,sequence));
  CREATE INDEX annotation_node ON annotations(node_id,sequence);
`);
const positionInsert = db.prepare('INSERT OR IGNORE INTO positions(hash,exact_key) VALUES (?,?)');
const positionGet = db.prepare('SELECT id FROM positions WHERE hash=? AND exact_key=?');
const prefixInsert = db.prepare('INSERT OR IGNORE INTO prefixes(parent_id,move,position_id) VALUES (?,?,?)');
const prefixGet = db.prepare('SELECT id FROM prefixes WHERE parent_id=? AND move=?');
const rootGet = db.prepare('SELECT id FROM prefixes WHERE parent_id IS NULL AND position_id=?');
const nodeInsert = db.prepare('INSERT INTO nodes(document_id,parent_id,ordinal,source_index,source_path,viewer_path,prefix_id,position_id,uci,san,mainline,leaf_lo,leaf_hi) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
const annotationInsert = db.prepare('INSERT INTO annotations(document_id,node_id,sequence,language,type,status,payload_json) VALUES (?,?,?,?,?,?,?)');
const docInsert = db.prepare('INSERT INTO documents(source_key,tree_hash) VALUES (?,?)');
const report = { version: SOURCE_TREE_VERSION, source_sha256: source.source_sha256,
  journalMode: 'WAL', synchronous: 'FULL',
  hardware: { platform: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), node: process.version },
  selection: source.selection, selected: source.games.length, accepted: 0, quarantined: [],
  nodeCount: 0, leafCount: 0, annotations: {}, duplicateViewerPaths: [], records: [] };
const started = performance.now();
let peakRss = process.memoryUsage().rss;
function verifyViewer(tree, annotations) {
  const pgn = generateViewerPgn(tree, annotations);
  const [game] = parsePgn(pgn);
  if (!game) throw new Error('Generated viewer PGN did not parse');
  const expected = tree.nodes.map(n => [n.path.join('.'), n.uci]);
  const actual = [['', null]], recovered = [];
  const readComments = list => {
    for (const comment of list ?? []) {
      const match = /^\[%opening ([A-Za-z0-9+/=]+)\]$/.exec(comment);
      if (!match) throw new Error('Generated viewer annotation was truncated');
      recovered.push(JSON.parse(Buffer.from(match[1], 'base64')));
    }
  };
  readComments(game.comments);
  function visit(n, position, path) {
    for (let i = 0; i < n.children.length; i++) {
      const child = n.children[i];
      const move = parseSan(position, child.data.san);
      if (!move || !position.isLegal(move)) throw new Error('Generated viewer move is illegal');
      const childPath = [...path, i];
      actual.push([childPath.join('.'), makeUci(move)]);
      readComments(child.data.startingComments); readComments(child.data.comments);
      const next = position.clone(); next.play(move);
      visit(child, next, childPath);
    }
  }
  visit(game.moves, startingPosition(game.headers).unwrap(), []);
  const order = (a, b) => a[0].localeCompare(b[0]);
  assert.deepEqual(actual.sort(order), expected.sort(order));
  assert.deepEqual(recovered.sort((a, b) => a.sequence - b.sequence), annotations.filter(a => a.sourcePath !== null));
  return Buffer.byteLength(pgn);
}
try {
  for (const game of source.games) {
    const recordStarted = performance.now();
    const key = `${game.relative_path}:${game.source_record_id}`;
    let phase = 'source-replay';
    try {
      if (JSON.parse(game.errors_json).some(e => /game_decode|record_decode/.test(e.stage)))
        throw new Error('Source move decoder error; cannot validate a complete tree');
      const tree = readSourceTree(game);
      const annotations = normalizeAnnotations(tree, game.annotations);
      phase = 'viewer-roundtrip';
      const viewerBytes = verifyViewer(tree, annotations);
      const duplicates = new Set(), seenPaths = new Set();
      for (const n of tree.nodes) {
        if (seenPaths.has(n.viewerPath)) duplicates.add(n.viewerPath);
        seenPaths.add(n.viewerPath);
      }
      if (duplicates.size) report.duplicateViewerPaths.push({ key, count: duplicates.size });
      phase = 'storage';
      db.transaction(() => {
        const documentId = docInsert.run(key, tree.treeHash).lastInsertRowid;
        const ids = new Map();
        // Source PGN order always places a parent before its children.
        for (const n of tree.nodes) {
          positionInsert.run(n.hash, n.exactKey);
          const positionId = positionGet.get(n.hash, n.exactKey).id;
          const parent = n.parent ? ids.get(n.parent) : null;
          prefixInsert.run(parent?.prefixId ?? null, n.uci, positionId);
          const prefixId = parent ? prefixGet.get(parent.prefixId, n.uci).id : rootGet.get(positionId).id;
          const nodeId = nodeInsert.run(documentId, parent?.nodeId ?? null, n.ordinal, n.sourceIndex,
            n.path.join('.'), n.viewerPath, prefixId, positionId, n.uci, n.san, Number(n.mainline), n.leafLo, n.leafHi).lastInsertRowid;
          ids.set(n, { nodeId, prefixId });
        }
        for (const a of annotations) {
          const n = tree.nodes.find(n => n.path.join('.') === a.sourcePath);
          annotationInsert.run(documentId, n ? ids.get(n).nodeId : null, a.sequence, a.sourceLanguage,
            a.type, a.status, JSON.stringify(a));
        }
      })();
      report.accepted++;
      report.nodeCount += tree.nodes.length;
      report.leafCount += tree.leafCount;
      for (const a of annotations) {
        const type = `${a.type}/${a.status}`;
        report.annotations[type] = (report.annotations[type] ?? 0) + 1;
      }
      report.records.push({ key, moves: tree.moveCount, leaves: tree.leafCount,
        annotations: annotations.length, viewerBytes, elapsedMs: performance.now() - recordStarted });
    } catch (error) {
      report.quarantined.push({ key, id: game.id, phase, reason: error.message.slice(0, 1200) });
    }
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    if ((report.accepted + report.quarantined.length) % 100 === 0)
      console.log(`Processed ${report.accepted + report.quarantined.length}/${source.games.length}`);
  }
  db.exec('ANALYZE');
  report.integrity = db.pragma('integrity_check');
  report.foreignKeys = db.pragma('foreign_key_check');
  report.prefixCount = db.prepare('SELECT count(*) n FROM prefixes').get().n;
  report.positionCount = db.prepare('SELECT count(*) n FROM positions').get().n;
  report.prefixPlan = db.prepare('EXPLAIN QUERY PLAN SELECT id FROM prefixes WHERE parent_id=? AND move=?').all(1, 'e2e4');
  report.rootPlan = db.prepare('EXPLAIN QUERY PLAN SELECT id FROM prefixes WHERE parent_id IS NULL AND position_id=?').all(1);
  report.elapsedSeconds = (performance.now() - started) / 1000;
  report.nodesPerSecond = report.nodeCount / report.elapsedSeconds;
  report.peakRssBytes = Math.max(peakRss, process.resourceUsage().maxRSS * 1024);
  try { report.tableBytes = db.prepare('SELECT name,sum(pgsize) bytes FROM dbstat GROUP BY name').all(); }
  catch { report.tableBytes = 'dbstat unavailable in bundled SQLite'; }
  report.pageSize = db.pragma('page_size', { simple: true });
  report.pageCount = db.pragma('page_count', { simple: true });
  db.pragma('wal_checkpoint(TRUNCATE)');
} finally { db.close(); }
report.databaseBytes = statSync(destination).size;
writeFileSync(destination + '.report.json', JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ ...report, records: `${report.records.length} details in local report`, quarantined: report.quarantined }, null, 2));
if (report.foreignKeys.length || report.integrity.some(r => r.integrity_check !== 'ok')) process.exitCode = 1;
