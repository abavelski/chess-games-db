import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureArchive, catalogueFiles, frame, hash } from './fixtures/opening-archive.mjs';
import { buildCatalogue, digest } from '../electron/openings.mjs';
import { enrichOpenings } from '../electron/opening-enrichment.mjs';
import { readCatalogue } from '../scripts/openings.mjs';

const input = (files = catalogueFiles) => ({ catalogue: buildCatalogue(files), manifest: { commit: 'a'.repeat(40) }, checksum: digest(JSON.stringify(files)) });
test('enrichment stages, resumes, publishes, invalidates and preserves source data', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'opening-enrich-'));
  try {
    const path = join(directory, 'test.db'), db = fixtureArchive(path);
    const original = db.prepare('SELECT * FROM games').all();
    const bytes = readFileSync(path);
    assert.equal((await enrichOpenings(path, input(), { dryRun: true })).pending, 4);
    assert.deepEqual(readFileSync(path), bytes);
    const part = await enrichOpenings(path, input(), { maxGames: 1 });
    assert.equal(part.published, false); assert.equal(db.prepare('SELECT * FROM opening_state').get(), undefined);
    const full = await enrichOpenings(path, input());
    assert.equal(full.revision, part.revision); assert.equal(full.published, true);
    assert.deepEqual(full.statuses, { invalid: 1, matched: 2, unmatched: 1 });
    assert.equal((await enrichOpenings(path, input())).processed, 0);
    const cancelled = new AbortController(); cancelled.abort();
    const staging = await enrichOpenings(path, input(), { rebuild: true, signal: cancelled.signal });
    assert.equal(staging.published, false); assert.equal(db.prepare('SELECT revision_id FROM opening_state').get().revision_id, full.revision);
    assert.deepEqual(db.prepare('SELECT * FROM games').all(), original);
    const pgn = '1.e4 *';
    db.prepare('UPDATE games SET pgn_zstd=?,pgn_sha256=? WHERE id=3').run(frame(pgn), hash(pgn));
    const updated = await enrichOpenings(path, input());
    assert.equal(updated.published, true); assert.equal(updated.statuses.matched, 3);
    const changedInput = input({ ...catalogueFiles, b: catalogueFiles.b.replace('King Pawn', 'King Pawn Updated') });
    const next = await enrichOpenings(path, changedInput, { maxGames: 1 });
    assert.equal(next.published, false); assert.equal(db.prepare('SELECT revision_id FROM opening_state').get().revision_id, updated.revision);
    const done = await enrichOpenings(path, changedInput);
    assert.equal(done.published, true); assert.notEqual(done.revision, updated.revision);
    db.prepare("UPDATE games SET pgn_sha256=? WHERE id=1").run('b'.repeat(64));
    const corrupted = await enrichOpenings(path, changedInput);
    assert.equal(corrupted.statuses.invalid, 2);
    assert.match(db.prepare('SELECT diagnostic FROM game_openings WHERE revision_id=? AND game_id=1').get(corrupted.revision).diagnostic, /SHA-256/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('local catalogue requires pinned identity, checksums and all five validated files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'opening-input-'));
  try {
    mkdirSync(join(directory, 'catalogue'));
    const folder = join(directory, 'catalogue'), manifest = { commit: 'a'.repeat(40), files: {} };
    for (const [file, content] of Object.entries(catalogueFiles)) {
      writeFileSync(join(folder, file + '.tsv'), content); manifest.files[file + '.tsv'] = digest(content);
    }
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify(manifest));
    assert.equal((await readCatalogue(folder)).catalogue.entries.length, 7);
    writeFileSync(join(folder, 'a.tsv'), 'tampered');
    await assert.rejects(readCatalogue(folder), /Checksum mismatch/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
