import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, copyFileSync, writeFileSync, statSync, utimesSync, renameSync } from 'node:fs';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSearchPosition, positionFingerprint } from '../lib/position-hash.mjs';
import { parseUci } from 'chessops/util';
import { createOpeningSource } from './fixtures/opening-study-source.mjs';
import { treeFixtures } from './fixtures/opening-study.mjs';
import { initializeBuild } from '../scripts/build-opening-library.mjs';
import { publishOpeningLibrary } from '../lib/opening-publication.mjs';
import { OpeningQueryService, STANDARD_OPENING_FEN } from '../lib/opening-query.mjs';
import { OpeningWorkerClient, validateOpeningPayload, registerOpeningQueryIpc } from '../electron/opening-query-client.mjs';

const folder = mkdtempSync(join(tmpdir(), 'opening-query-'));
const args = { source: join(folder, 'source.sqlite'), staging: join(folder, 'staging.sqlite'), output: join(folder, 'ready.sqlite'), corpus: 'synthetic', progress: () => {} };
createOpeningSource(args.source);
initializeBuild(args);
initializeBuild({ ...args, resume: true, phase: 'trees' });
initializeBuild({ ...args, resume: true, phase: 'articles' });
publishOpeningLibrary(args);
const service = new OpeningQueryService(args.output), revision = service.catalog().revision;
test.after(() => { service.close(); rmSync(folder, { recursive: true, force: true }); });
const query = (moves = [], extra = {}) => service.explore({ revision, moves, ...extra });

// Enumerate full leaf histories and exact positions independently of stored
// nodes, prefix IDs and leaf intervals. A repeated anchor contributes each leaf
// once even when more than one occurrence supports the suffix.
const paths = treeFixtures.filter(f => !f.invalid).flatMap((f, i) => {
  const leaves = f.leaves ?? (f.key === 'transposition-a' ? [['g1f3','d7d5','g2g3']]
    : f.key === 'transposition-b' ? [['g2g3','d7d5','g1f3']] : [['e2e4']]);
  return leaves.map((moves, leaf) => ({ doc: i + 1, leaf, root: f.start_fen, moves }));
});
function oracle(rootFen, suffix, mode, docFilter = () => true) {
  const rootKey = positionFingerprint(rootFen).verificationKey, docs = new Set(), leaves = new Set();
  const endings = new Set(), childLeaves = new Map();
  for (const path of paths.filter(p => docFilter(p.doc))) {
    const pos = parseSearchPosition(path.root), positions = [positionFingerprint(pos).verificationKey];
    for (const uci of path.moves) { const m = parseUci(uci); assert.ok(pos.isLegal(m)); pos.play(m); positions.push(positionFingerprint(pos).verificationKey); }
    const anchors = mode === 'prefix' ? (positions[0] === rootKey ? [0] : []) : positions.flatMap((key, i) => key === rootKey ? [i] : []);
    for (const anchor of anchors) {
      if (!suffix.every((move, i) => path.moves[anchor + i] === move)) continue;
      const at = anchor + suffix.length, identity = `${path.doc}:${path.leaf}`;
      docs.add(path.doc); leaves.add(identity);
      if (at === path.moves.length) endings.add(identity);
      else { const values = childLeaves.get(path.moves[at]) ?? new Set(); values.add(identity); childLeaves.set(path.moves[at], values); }
    }
  }
  return { games: docs.size, lines: leaves.size, endings: endings.size, children: new Map([...childLeaves].map(([m, s]) => [m, s.size])) };
}
function agrees(actual, expected) {
  assert.equal(actual.gameRecordCount, expected.games);
  assert.equal(actual.sourceLineCount, expected.lines);
  assert.equal(actual.endingLineCount, expected.endings);
  assert.deepEqual(new Map(actual.continuations.map(c => [c.uci, c.sourceLineCount]).sort()), new Map([...expected.children].sort()));
}

test('whole-prefix counters and children agree with an explicit leaf oracle, including duplicate siblings and terminal prefixes', () => {
  for (const moves of [[], ['e2e4'], ['e2e4','c7c5'], ['e2e4','c7c6'], ['e2e4','e7e5'], ['e2e4','e7e5','b1c3'], ['a2a3']])
    agrees(query(moves), oracle(STANDARD_OPENING_FEN, moves, 'prefix'));
  assert.equal(query(['e2e4']).relatedArticleCount, 1);
  assert.equal(query(['a2a3']).exhausted, false);
  assert.equal(query(['e2e4','c7c5','g1f3']).exhausted, true);
});

test('position discovery adds transpositions once; repeated anchors union descendant leaves per document', () => {
  const prefix = query(['g1f3','d7d5','g2g3']);
  assert.equal(prefix.gameRecordCount, 1);
  const anchor = query([], { mode: 'position', rootFen: prefix.fen });
  agrees(anchor, oracle(prefix.fen, [], 'position'));
  assert.equal(anchor.gameRecordCount, 2);
  const repeated = query([], { mode: 'position', filters: { query: 'Synthetic White 4' } });
  agrees(repeated, oracle(STANDARD_OPENING_FEN, [], 'position', id => id === 4));
  assert.equal(repeated.sourceLineCount, 2);
  assert.equal(repeated.continuations.reduce((sum, c) => sum + c.sourceLineCount, 0), 4);
  agrees(query(['e2e4'], { mode: 'position', filters: { query: 'Synthetic White 4' } }), oracle(STANDARD_OPENING_FEN, ['e2e4'], 'position', id => id === 4));
});

test('custom roots, exact castling/EP keys and filters retain one consistent scope', () => {
  const setup = treeFixtures.find(f => f.key === 'setup-counters');
  agrees(query([], { rootFen: setup.start_fen }), oracle(setup.start_fen, [], 'prefix'));
  assert.equal(query([], { rootFen: STANDARD_OPENING_FEN.replace('KQkq', '-') }).sourceLineCount, 0);
  assert.equal(query([], { rootFen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' }).gameRecordCount, 0);
  const main = query(['e2e4'], { filters: { roles: ['main_games'] } });
  agrees(main, oracle(STANDARD_OPENING_FEN, ['e2e4'], 'prefix', id => id % 2 === 1));
  assert.equal(query([], { filters: { annotationLanguages: ['en'] } }).gameRecordCount, 1);
  assert.equal(query([], { filters: { annotationLanguages: ['und'] } }).gameRecordCount, 0, 'Language filters select comments, not untagged NAGs/drawings');
  const articleKey = 'synthetic:theory/synthetic.cbh:100';
  assert.equal(query([], { filters: { articleKeys: [articleKey] } }).gameRecordCount, 1);
  assert.equal(query([], { filters: { articleKeys: [articleKey], roles: ['theory'] } }).gameRecordCount, 0);
  assert.equal(query([], { filters: { query: 'Synthetic Sicilian plans' } }).gameRecordCount, 1);
  assert.equal(query([], { filters: { articleKeys: ['missing'] } }).gameRecordCount, 0);
  const e4 = query(['e2e4']);
  const withoutEp = e4.fen.split(' '); withoutEp[3] = '-';
  assert.equal(query([], { mode: 'position', rootFen: e4.fen }).sourceLineCount,
    query([], { mode: 'position', rootFen: withoutEp.join(' ') }).sourceLineCount);
});

test('exact keys reject a simulated hash collision and retain pinned-pawn en-passant identity', () => {
  const collisionPath = join(folder, 'collision.sqlite');
  copyFileSync(args.output, collisionPath);
  const collision = new Database(collisionPath), fingerprint = positionFingerprint(STANDARD_OPENING_FEN);
  const other = collision.prepare('SELECT id FROM positions WHERE exact_key!=? LIMIT 1').get(fingerprint.verificationKey);
  collision.prepare('UPDATE positions SET hash=? WHERE id=?').run(fingerprint.sqliteHash, other.id);
  collision.close();
  const reader = new OpeningQueryService(collisionPath);
  try { assert.equal(reader.explore({ revision, moves: [] }).gameRecordCount, 6); }
  finally { reader.close(); }
  const next = { ...args, source: join(folder, 'ep-source.sqlite'), staging: join(folder, 'ep-staging.sqlite'), output: join(folder, 'ep-ready.sqlite') };
  createOpeningSource(next.source);
  const input = new Database(next.source);
  const pinned = 'k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
  input.prepare("UPDATE games SET start_fen=?,moves_pgn='1. Kf2',all_lines_ply=1 WHERE id=3").run(pinned); input.close();
  initializeBuild(next); initializeBuild({ ...next, resume: true, phase: 'trees' }); initializeBuild({ ...next, resume: true, phase: 'articles' }); publishOpeningLibrary(next);
  const epReader = new OpeningQueryService(next.output), epRevision = epReader.catalog().revision;
  try {
    assert.equal(epReader.explore({ revision: epRevision, mode: 'position', rootFen: pinned, moves: [] }).gameRecordCount, 1);
    assert.equal(epReader.explore({ revision: epRevision, mode: 'position', rootFen: pinned.replace('d6', '-'), moves: [] }).gameRecordCount, 0);
  } finally { epReader.close(); }
});

test('pages, language presentation and exact review matches cannot alter counters', () => {
  const q = query(['e2e4']);
  const first = service.materials({ revision, token: q.token, kind: 'games', pageSize: 1 });
  const second = service.materials({ revision, token: q.token, kind: 'games', pageSize: 1, page: 2 });
  assert.equal(first.total, 3); assert.equal(second.total, 3); assert.notEqual(first.items[0].key, second.items[0].key);
  const c6 = query(['e2e4','c7c6']);
  const comments = service.materials({ revision, token: c6.token, kind: 'comments', language: 'en' });
  assert.deepEqual(comments.items.map(c => c.sequence), [1,2,9]);
  assert.ok(comments.items.every(c => c.language === 'en'));
  const card = service.materials({ revision, token: c6.token, kind: 'games' }).items[0];
  const detail = service.study({ revision, token: c6.token, key: card.key, treeHash: card.treeHash, sourcePath: card.match.sourcePath,
    expectedPositionKey: positionFingerprint(c6.fen).verificationKey });
  assert.equal(detail.matchPath, '0.1'); assert.equal(detail.notice, null);
  assert.equal(detail.annotations.find(a => a.sequence === 1).placement, 'before');
  assert.equal(service.study({ revision, key: card.key, treeHash: '0'.repeat(64), sourcePath: '0.1' }).matchPath, '');
  assert.equal(query(['e2e4']).sourceLineCount, q.sourceLineCount);
});

test('standalone article catalog and safe language fallback use controlled exact targets', () => {
  const catalog = service.articleCatalog({ revision, query: 'standalone' });
  assert.equal(catalog.total, 1);
  assert.equal(service.article({ revision, key: catalog.items[0].key }).examplesTotal, 0);
  const article = service.article({ revision, key: 'synthetic:theory/synthetic.cbh:100', language: 'en' });
  assert.equal(article.language, 'de'); assert.equal(article.fallback, true);
  assert.equal(article.examples.length, 1); assert.equal(article.examples[0].evidence.length, 2);
  assert.deepEqual(article.targets.map(t => t.status), ['resolved','ambiguous','unavailable']);
  assert.match(article.targets[0].evidence.notice, /unvalidated/);
});

test('invalid and expired inputs produce bounded errors without SQL authority', () => {
  assert.throws(() => query(['e2e5']), /Illegal/);
  assert.throws(() => query(Array(2049).fill('e2e4')), /limit/);
  assert.throws(() => query([], { filters: { sql: 'DELETE FROM study_nodes' } }), /Unknown/);
  assert.throws(() => service.materials({ revision, token: 'expired' }), /expired/);
  assert.throws(() => service.explore({ revision: 'old' }), /revision/);
  assert.throws(() => validateOpeningPayload('executeSql', {}), /Unsupported/);
  assert.throws(() => validateOpeningPayload('explore', { query: 'a'.repeat(33000) }), /payload/);
  const handlers = new Map();
  registerOpeningQueryIpc({ ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) }, getClient: () => null });
  assert.equal(handlers.size, 6);
  assert.throws(() => handlers.get('opening-study:explore')({}, {}), /Open an opening library/);
  const first = query([]);
  for (let fullmoves = 2; fullmoves < 12; fullmoves++) query([], { rootFen: STANDARD_OPENING_FEN.replace('0 1', `0 ${fullmoves}`) });
  assert.throws(() => service.materials({ revision, token: first.token }), /expired/);
});

test('worker uses the native read-only service and coalesces stale explorations', async () => {
  const client = new OpeningWorkerClient(args.output);
  try {
    const catalog = await client.ready;
    assert.equal(catalog.coverage.searchableDocuments, 7);
    const requests = [1,2,3].map(requestId => client.call('explore', { revision, requestId, moves: [] }));
    const results = await Promise.allSettled(requests);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected'); assert.equal(results[1].reason.code, 'CANCELLED');
    assert.equal(results[2].status, 'fulfilled'); assert.equal(results[2].value.requestId, 3);
    assert.equal(results[2].value.sourceLineCount, 10);
  } finally { await client.close(); }
});

test('missing, corrupt and changed runtime files fail recoverably; runtime does not require its source', async () => {
  assert.throws(() => new OpeningQueryService(join(folder, 'missing.sqlite')));
  const corruptPath = join(folder, 'corrupt.sqlite'); writeFileSync(corruptPath, 'not a SQLite library');
  const corrupt = new OpeningWorkerClient(corruptPath);
  try { await assert.rejects(corrupt.ready); } finally { await corrupt.close(); }
  const changedPath = join(folder, 'changed.sqlite'); copyFileSync(args.output, changedPath);
  const changed = new OpeningQueryService(changedPath);
  try {
    const time = statSync(changedPath); utimesSync(changedPath, time.atime, new Date(time.mtimeMs + 2000));
    assert.throws(() => changed.explore({ revision }), /changed/);
  } finally { changed.close(); }
  const absentSource = args.source + '.absent'; renameSync(args.source, absentSource);
  try {
    const independent = new OpeningQueryService(args.output);
    try { assert.equal(independent.explore({ revision }).gameRecordCount, 6); } finally { independent.close(); }
  } finally { renameSync(absentSource, args.source); }
});

test('worker failure rejects queued requests and a new worker recovers', async () => {
  const client = new OpeningWorkerClient(args.output); await client.ready;
  const pending = Promise.allSettled([client.call('explore', { revision }), client.call('explore', { revision, requestId: 2 })]);
  await Promise.resolve();
  assert.ok(client.pending.size > 0);
  const exited = new Promise(resolve => client.worker.once('exit', resolve));
  await client.worker.terminate(); await exited;
  assert.ok((await pending).every(result => result.status === 'rejected'));
  await assert.rejects(client.call('explore', { revision }), /closed|stopped/);
  await client.close();
  const replacement = new OpeningWorkerClient(args.output);
  try { await replacement.ready; assert.equal((await replacement.call('explore', { revision })).gameRecordCount, 6); }
  finally { await replacement.close(); }
});
