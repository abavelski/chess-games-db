import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeGames, upsertGame } from '../lib/game-writer.mjs';
import { ChessArchive } from '../electron/database.mjs';
import { frame, hash } from './fixtures/opening-archive.mjs';

test('personal analysis persists in archive, composes with filters and preserves source PGN', () => {
  const dir = mkdtempSync(join(tmpdir(), 'personal-')), path = join(dir, 'games.db');
  let archive;
  try {
    const db = new Database(path); initializeGames(db);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='game_personal_analysis'").get(), 'Fresh archives include personal-analysis storage');
    const pgn = '1.e4 {Book annotation} e5 *', payload = { pgn_zstd: frame(pgn), pgn_sha256: hash(pgn) };
    const first = upsertGame(db, { ...payload, white: 'Alice', year: 2000 });
    const second = upsertGame(db, { ...payload, white: 'Bob', year: 2020 });
    db.close();
    const original = readFileSync(path);
    archive = new ChessArchive(path);
    assert.deepEqual(archive.getGame(first).personal, { lines: [], comments: [] });
    assert.equal(archive.searchGames({ personalOnly: true }).total, 0);
    assert.equal(archive.openingFacets({ personalOnly: true }).total, 0);
    assert.deepEqual(readFileSync(path), original);
    assert.throws(() => archive.savePersonal(first, { lines: [['e2e5']], comments: [] }));
    assert.throws(() => archive.savePersonal(99999, { lines: [], comments: [] }));
    assert.deepEqual(readFileSync(path), original);
    const personal = { lines: [['e2e4', 'c7c5']], comments: [{ moves: ['e2e4', 'c7c5'], text: 'My line' }, { moves: [], text: 'My game note' }] };
    archive.savePersonal(first, personal);
    assert.equal(archive.searchGames({ personalOnly: true }).total, 1);
    assert.equal(archive.searchGames({ personalOnly: true, favouritesOnly: true }).total, 0);
    archive.setFavourite(first, true);
    assert.equal(archive.searchGames({ personalOnly: true, favouritesOnly: true, search: 'Alice' }).total, 1);
    assert.equal(archive.searchGames({ personalOnly: true, yearFrom: '2010' }).total, 0);
    assert.equal(archive.openingFacets({ personalOnly: true }).total, 1);
    const years = archive.propertyOptions({ property: 'year', filters: { personalOnly: true } }).options;
    assert.equal(years.find(o => o.id === '2000').count, 1);
    assert.equal(years.find(o => o.id === '2020').count, 0);
    archive.close(); archive = new ChessArchive(path);
    assert.deepEqual(archive.getGame(first).personal, personal);
    assert.equal(archive.getGame(first).pgn, pgn);
    archive.savePersonal(second, { lines: [], comments: [{ moves: [], text: 'Comment only' }] });
    archive.savePersonal(first, { lines: [], comments: [] });
    assert.deepEqual(archive.searchGames({ personalOnly: true }).rows.map(row => row.id), [second]);
    assert.equal(archive.openingFacets({ personalOnly: true }).total, 1);
    assert.equal(archive.getGame(first).favourite, 1);
    assert.throws(() => archive.searchGames({ personalOnly: 'true' }), /Invalid personal/);
  } finally { archive?.close(); rmSync(dir, { recursive: true, force: true }); }
});


test('personal migration upgrades existing archives only on save and preserves earlier personal data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'personal-migration-')), path = join(dir, 'games.db');
  let archive;
  try {
    const db = new Database(path);
    db.exec(readFileSync(new URL('../db/migrations/007_games.sql', import.meta.url), 'utf8'));
    db.pragma('user_version=7');
    const pgn = '1.e4 e5 *';
    const id = upsertGame(db, { pgn_zstd: frame(pgn), pgn_sha256: hash(pgn) });
    db.close();
    const original = readFileSync(path);
    archive = new ChessArchive(path);
    assert.equal(archive.hasPersonalTable(), false);
    assert.deepEqual(archive.getGame(id).personal, { lines: [], comments: [] });
    assert.deepEqual(readFileSync(path), original, 'Reading does not apply migration');
    const personal = { lines: [], comments: [{ moves: [], text: 'Keep my note' }] };
    archive.savePersonal(id, personal);
    assert.equal(archive.hasPersonalTable(), true);
    assert.equal(archive.db.pragma('user_version', { simple: true }), 7);
    const writer = new Database(path);
    const migration = readFileSync(new URL('../db/migrations/008_personal_analysis.sql', import.meta.url), 'utf8');
    writer.transaction(() => { writer.exec(migration); writer.exec(migration); })();
    writer.close();
    assert.deepEqual(archive.getGame(id).personal, personal, 'Migration can be reapplied without replacing saved analysis');
    assert.equal(archive.getGame(id).pgn, pgn);
  } finally { archive?.close(); rmSync(dir, { recursive: true, force: true }); }
});
