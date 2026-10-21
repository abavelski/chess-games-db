import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeGames } from '../lib/game-writer.mjs';
import { inventoryArchive } from '../lib/import/inventory.mjs';
import { legacyFixtureArchive } from './fixtures/opening-archive.mjs';
test('inventory reconciles historical versions and v7 capabilities without writes', () => {
 const dir = mkdtempSync(join(tmpdir(), 'import-inventory-'));
 try {
  for (const version of [3,4,5,6,7]) {
   const path = join(dir, `${version}.db`);
   const db = version === 7 ? new Database(path) : legacyFixtureArchive(path);
   if (version === 7) { initializeGames(db); db.exec('ALTER TABLE games ADD COLUMN favourite INTEGER DEFAULT 0; CREATE TABLE external_notes(id INTEGER)'); }
   db.pragma(`user_version=${version}`); db.close();
   const before = readFileSync(path), result = inventoryArchive(path);
   assert.deepEqual(readFileSync(path), before);
   assert.equal(result.version, version);
   if (version === 7) { assert.equal(result.capabilities.favourites, true); assert.ok(result.unknownObjects.some(o => o.name === 'external_notes')); }
   else { assert.equal(result.legacy.total, result.legacy.retained + result.legacy.excluded.length); assert.equal(result.path, 'explicit-new-output-migration'); }
  }
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
