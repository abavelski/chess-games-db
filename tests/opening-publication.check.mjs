import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOpeningSource } from './fixtures/opening-study-source.mjs';
import { initializeBuild } from '../scripts/build-opening-library.mjs';
import { publishOpeningLibrary } from '../lib/opening-publication.mjs';
import { fileHash, openOpeningLibrary } from '../lib/opening-library-storage.mjs';

function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'opening-publication-'));
  const args = { source: join(folder, 'source.sqlite'), staging: join(folder, 'staging.sqlite'),
    output: join(folder, 'ready.sqlite'), corpus: 'synthetic', progress: () => {} };
  createOpeningSource(args.source);
  return { args, folder };
}
function convertAll(args) {
  initializeBuild(args);
  initializeBuild({ ...args, resume: true, phase: 'trees' });
  initializeBuild({ ...args, resume: true, phase: 'articles' });
}

test('complete synthetic pipeline publishes a closed source-independent ready artifact and reconciliation report', () => {
  const { args, folder } = fixture();
  try {
    const before = fileHash(args.source);
    convertAll(args);
    const report = publishOpeningLibrary(args);
    assert.equal(report.coverage.sourceItems, 16);
    assert.equal(report.coverage.searchableDocuments, 7);
    assert.equal(report.coverage.quarantinedDocuments, 6);
    assert.equal(report.coverage.sourceAnnotations, 10);
    assert.equal(report.coverage.articles, 3);
    assert.equal(fileHash(args.source), before);
    assert.equal(fileHash(args.output), report.artifactSHA256);
    assert.equal(readFileSync(args.output + '.sha256', 'utf8').trim(), report.artifactSHA256);
    assert.equal(existsSync(args.staging), false);
    assert.ok(!existsSync(args.output + '-wal'));
    const next = { ...args, staging: join(folder, 'next-staging.sqlite'), output: join(folder, 'next-ready.sqlite') };
    initializeBuild(next);
    assert.throws(() => publishOpeningLibrary(next), /unfinished/);
    assert.equal(fileHash(args.output), report.artifactSHA256, 'A failed generation cannot alter the previous ready artifact');
    rmSync(args.source);
    const { db, manifest } = openOpeningLibrary(args.output);
    assert.equal(manifest.status, 'ready');
    assert.equal(manifest.coverage.searchableDocuments, 7);
    assert.throws(() => db.exec('DELETE FROM study_nodes'), /readonly/);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    db.close();
    assert.throws(() => publishOpeningLibrary(args));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('unfinished processing and tampered intervals cannot publish; staging remains available', () => {
  const { args, folder } = fixture();
  try {
    initializeBuild(args);
    assert.throws(() => publishOpeningLibrary(args), /unfinished/);
    assert.equal(existsSync(args.output), false);
    initializeBuild({ ...args, resume: true, phase: 'trees' });
    initializeBuild({ ...args, resume: true, phase: 'articles' });
    const db = new Database(args.staging);
    db.prepare("UPDATE study_nodes SET leaf_hi=leaf_hi+1 WHERE document_id=1 AND parent_id IS NULL").run();
    db.close();
    assert.throws(() => publishOpeningLibrary(args), /invariant/);
    assert.equal(existsSync(args.output), false);
    assert.equal(existsSync(args.staging), true);
    assert.throws(() => openOpeningLibrary(args.staging), /unfinished/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('schema and annotation provenance tampering fail before ready publication', () => {
  for (const change of [
    "CREATE INDEX unversioned_index ON study_documents(white)",
    "UPDATE node_annotations SET language='invented' WHERE source_sequence=1",
    "UPDATE source_items SET stable_key='misattached' WHERE id=1",
  ]) {
    const { args, folder } = fixture();
    try {
      convertAll(args);
      const db = new Database(args.staging); db.exec(change); db.close();
      assert.throws(() => publishOpeningLibrary(args), /fingerprint|provenance|identity/);
      assert.equal(existsSync(args.output), false);
      assert.equal(existsSync(args.output + '.report.json'), false);
      assert.throws(() => openOpeningLibrary(args.staging), /unfinished/);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  }
});
