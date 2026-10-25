import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { treeFixtures } from './fixtures/opening-study.mjs';
import { createTreeConverter } from '../lib/opening-tree-converter.mjs';
import { BUILD_VERSIONS } from '../lib/opening-library-storage.mjs';
import { digest } from '../lib/opening-source-tree.mjs';

function database(fixtures) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(readFileSync(new URL('../db/opening-library-v1.sql', import.meta.url), 'utf8'));
  db.exec("INSERT INTO source_collections VALUES(1,'synthetic:theory','Theory','theory','cbh','theory','{}')");
  fixtures.forEach((fixture, i) => {
    db.prepare("INSERT INTO source_items VALUES(?,?,1,?,'game',0,?,'decoded','pending')").run(i + 1, fixture.key, i + 1, digest(fixture.key));
    db.prepare("INSERT INTO build_record_state(item_id,input_hash,converter_version,state) VALUES (?,?,?,'pending')")
      .run(i + 1, digest(fixture.key), BUILD_VERSIONS.builder);
  });
  return db;
}
const source = fixture => ({ ...fixture, annotations_decode_status: 'decoded_not_validated', errors_json: '[]' });

test('all-tree conversion agrees with explicit ordinal paths, leaves, positions and annotation provenance', () => {
  const fixtures = treeFixtures.filter(f => !f.invalid);
  const db = database(fixtures);
  try {
    const convert = createTreeConverter(db);
    for (const [i, f] of fixtures.entries()) convert(i + 1, source(f), f.annotations ?? []);
    assert.equal(db.prepare('SELECT count(*) n FROM study_documents').get().n, fixtures.length);
    for (const [i, f] of fixtures.entries()) {
      const nodes = db.prepare('SELECT * FROM study_nodes WHERE document_id=? ORDER BY source_index').all(i + 1);
      assert.equal(nodes.length, f.all_lines_ply + 1);
      if (f.expected) assert.deepEqual(nodes.slice(1).map(n => ({ san: n.san, path: n.source_path, sourceIndex: n.source_index })), f.expected);
      const byId = new Map(nodes.map(n => [n.id, n]));
      const leaves = nodes.filter(n => !nodes.some(other => other.parent_id === n.id)).sort((a, b) => a.leaf_lo - b.leaf_lo);
      const leafPaths = leaves.map(n => { const path = []; for (let c = n; c.parent_id !== null; c = byId.get(c.parent_id)) path.unshift(c.move_uci); return path; });
      if (f.leaves) assert.deepEqual(leafPaths, f.leaves);
      for (const n of nodes) {
        const expected = leaves.filter(leaf => n.source_path === '' || leaf.source_path === n.source_path || leaf.source_path.startsWith(n.source_path + '.'));
        assert.equal(n.leaf_hi - n.leaf_lo, expected.length);
        assert.equal(n.leaf_lo, expected[0].leaf_lo);
      }
    }
    const annotations = db.prepare('SELECT * FROM node_annotations WHERE document_id=1 ORDER BY source_sequence').all();
    for (const [i, a] of annotations.entries()) {
      assert.deepEqual(JSON.parse(a.original_json), JSON.parse(fixtures[0].annotations[i].payload_json));
      assert.equal(a.payload_hash, digest(fixtures[0].annotations[i].payload_json));
      assert.equal(a.source_language, fixtures[0].annotations[i].language);
    }
    assert.equal(annotations[0].placement, 'root');
    assert.equal(annotations[1].placement, 'before');
    assert.equal(annotations[7].support_status, 'unsupported');
    assert.equal(annotations[8].support_status, 'unsupported');
    const duplicate = db.prepare('SELECT * FROM study_nodes WHERE document_id=2 AND source_path IN (?,?)').all('0.0', '0.1');
    assert.equal(duplicate[0].prefix_id, duplicate[1].prefix_id);
    assert.notEqual(duplicate[0].id, duplicate[1].id);
    const otherRoot = db.prepare('SELECT id FROM study_nodes WHERE document_id=2 AND parent_id IS NULL').get().id;
    assert.throws(() => db.prepare("UPDATE study_nodes SET parent_id=? WHERE document_id=1 AND source_path='0'").run(otherRoot), /FOREIGN KEY/);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});

test('invalid branches quarantine entire trees, retaining a documented annotation disposition', () => {
  const fixtures = treeFixtures.filter(f => f.invalid);
  const db = database(fixtures);
  try {
    const convert = createTreeConverter(db);
    for (const [i, f] of fixtures.entries()) convert(i + 1, source(f), []);
    assert.equal(db.prepare('SELECT count(*) n FROM study_nodes').get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM source_items WHERE validation_status='quarantined'").get().n, fixtures.length);
    assert.equal(db.prepare('SELECT count(*) n FROM quality_issues').get().n, fixtures.length);
  } finally { db.close(); }
});

test('annotation publication failure rolls back nodes, prefixes and checkpoint; unmapped annotations remain partial', () => {
  const f = treeFixtures[0], db = database([f]);
  try {
    const convert = createTreeConverter(db);
    db.exec("CREATE TRIGGER simulate_failure BEFORE INSERT ON node_annotations WHEN NEW.source_sequence=2 BEGIN SELECT RAISE(ABORT,'simulated failure'); END");
    assert.throws(() => convert(1, source(f), f.annotations), /simulated failure/);
    for (const table of ['positions','prefix_roots','move_prefixes','study_documents','study_nodes','node_annotations'])
      assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
    assert.equal(db.prepare('SELECT state FROM build_record_state').get().state, 'pending');
    db.exec('DROP TRIGGER simulate_failure');
    const unmapped = { ...f.annotations[1], sequence: 10, move_index: 999 };
    convert(1, source(f), [...f.annotations, unmapped]);
    assert.equal(db.prepare('SELECT annotation_coverage FROM study_documents').get().annotation_coverage, 'partial');
    const a = db.prepare('SELECT node_id,support_status,original_json FROM node_annotations WHERE source_sequence=10').get();
    assert.equal(a.node_id, null); assert.equal(a.support_status, 'unmapped');
    assert.equal(a.original_json, unmapped.payload_json);
    assert.equal(convert(1, source(f), f.annotations), false);
  } finally { db.close(); }
});
