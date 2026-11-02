import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync, linkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeBuild } from '../scripts/build-opening-library.mjs';
import { checkpointItem, cleanupDerived, fileHash, createStaging, openOpeningLibrary, stableSourceKey, validateBuildPaths } from '../lib/opening-library-storage.mjs';

function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'opening-staging-'));
  const source = join(folder, 'source.sqlite'), staging = join(folder, 'staging.sqlite'), output = join(folder, 'output.sqlite');
  const db = new Database(source);
  db.exec(readFileSync(new URL('../docs/opening-theory/book-library-schema.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO import_runs VALUES(1,'now','now','extracted','not_run','{}','{}');
    INSERT INTO source_databases(id,import_run_id,relative_path,absolute_path,file_name,format,role,status)
      VALUES(1,1,'Theory/Synthetic.cbh','not-used','Synthetic.cbh','cbh','theory','complete');
    INSERT INTO source_records(id,database_id,source_record_id,record_type,source_deleted,header_json,decode_status,decoder_metadata_json)
      VALUES(1,1,7,'game',0,'{}','decoded','{}');`);
  db.close();
  return { source, staging, output, corpus: 'synthetic', folder };
}

test('staging inventory is resumable, immutable-source-bound and never ready', () => {
  const f = fixture();
  try {
    const before = fileHash(f.source);
    const result = initializeBuild(f);
    assert.equal(result.inventoried, 1);
    assert.equal(fileHash(f.source), before);
    assert.equal(existsSync(f.output), false);
    assert.throws(() => openOpeningLibrary(f.staging), /unfinished/);
    assert.throws(() => openOpeningLibrary(f.source), /supported opening runtime/);
    const first = new Database(f.staging, { readonly: true });
    const key = first.prepare('SELECT stable_key FROM source_items').get().stable_key;
    const uuid = first.prepare('SELECT library_uuid FROM library_manifest').get().library_uuid;
    assert.equal(key, 'synthetic:theory/synthetic.cbh:7');
    first.close();
    initializeBuild({ ...f, resume: true });
    const resumed = new Database(f.staging);
    assert.equal(resumed.prepare('SELECT count(*) n FROM source_items').get().n, 1);
    assert.equal(resumed.prepare('SELECT library_uuid FROM library_manifest').get().library_uuid, uuid);
    assert.equal(resumed.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(resumed.pragma('foreign_key_check'), []);
    resumed.exec(`INSERT INTO positions VALUES(1,1,'orphan');
      INSERT INTO prefix_roots VALUES(1,1);
      INSERT INTO move_prefixes VALUES(1,1,NULL,0,NULL,1);
      INSERT INTO move_prefixes VALUES(2,1,1,1,'e2e4',1);`);
    cleanupDerived(resumed);
    assert.equal(resumed.prepare('SELECT count(*) n FROM positions').get().n, 0);
    resumed.exec("UPDATE library_manifest SET status='ready'");
    resumed.close();
    assert.throws(() => openOpeningLibrary(f.staging), /Invalid ready manifest/);
    const reset = new Database(f.staging); reset.exec("UPDATE library_manifest SET status='building'"); reset.close();
    assert.throws(() => createStaging({ staging: f.staging, sourceHash: 'changed', corpus: f.corpus, resume: true }), /Incompatible resume/);
    assert.throws(() => createStaging({ staging: f.staging, sourceHash: before, corpus: 'other', resume: true }), /Incompatible resume/);
    const secondStaging = join(f.folder, 'second.sqlite');
    initializeBuild({ ...f, staging: secondStaging });
    const second = new Database(secondStaging, { readonly: true });
    assert.equal(second.prepare('SELECT stable_key FROM source_items').get().stable_key, key);
    second.close();
  } finally { rmSync(f.folder, { recursive: true, force: true }); }
});

test('document checkpoint rolls back publication and can retry atomically', () => {
  const f = fixture();
  try {
    initializeBuild(f);
    const db = new Database(f.staging); db.pragma('foreign_keys=ON');
    assert.throws(() => checkpointItem(db, 1, () => {
      db.prepare("INSERT INTO quality_issues(item_id,stage,severity,code,detail,disposition) VALUES(1,'test','error','test','detail','quarantine')").run();
      throw new Error('simulated interruption');
    }), /interruption/);
    assert.equal(db.prepare('SELECT count(*) n FROM quality_issues').get().n, 0);
    assert.equal(db.prepare('SELECT state FROM build_record_state').get().state, 'pending');
    assert.equal(checkpointItem(db, 1, () => ({ status: 'quarantined' })), true);
    assert.equal(checkpointItem(db, 1, () => { throw new Error('must not run twice'); }), false);
    assert.equal(db.prepare('SELECT validation_status FROM source_items').get().validation_status, 'quarantined');
    db.close();
  } finally { rmSync(f.folder, { recursive: true, force: true }); }
});

test('aliases, existing outputs, source types, versions and input changes are refused', () => {
  const f = fixture();
  try {
    assert.throws(() => validateBuildPaths(f.source, f.source, f.output), /different paths/);
    linkSync(f.source, f.staging);
    assert.throws(() => validateBuildPaths(f.source, f.staging, f.output, true), /aliases/);
    rmSync(f.staging);
    const wrong = new Database(f.staging); wrong.pragma('user_version=7'); wrong.close();
    assert.throws(() => initializeBuild({ ...f, source: f.staging, staging: join(f.folder, 'new.sqlite') }), /source schema/);
    rmSync(f.staging);
    initializeBuild(f);
    const changed = new Database(f.source); changed.exec("UPDATE source_records SET header_json='{} '"); changed.close();
    assert.throws(() => initializeBuild({ ...f, resume: true }), /Incompatible resume/);
    const output = new Database(f.output); output.close();
    assert.throws(() => initializeBuild({ ...f, resume: true }), /Output already exists/);
    assert.throws(() => stableSourceKey('synthetic', '../external', 1), /relative/);
    assert.equal(stableSourceKey('synthetic', 'Theory\\SYNTHETIC.cbh', 7), 'synthetic:theory/synthetic.cbh:7');
  } finally { rmSync(f.folder, { recursive: true, force: true }); }
});
