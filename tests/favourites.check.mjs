import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeGames, upsertGame } from '../lib/game-writer.mjs';
import { ChessArchive } from '../electron/database.mjs';
import { frame, hash } from './fixtures/opening-archive.mjs';

test('favourites persist per game, compose with filters and refresh contextual counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'favourites-')), path = join(dir, 'games.db');
  let archive;
  try {
    const db = new Database(path); initializeGames(db);
    const pgn = '1. e4 *', payload = { pgn_zstd: frame(pgn), pgn_sha256: hash(pgn) };
    const first = upsertGame(db, { ...payload, white: 'Alice', year: 2000 });
    const second = upsertGame(db, { ...payload, white: 'Bob', year: 2020 });
    db.close();
    const original = readFileSync(path);
    archive = new ChessArchive(path);
    assert.equal(archive.getGame(first).favourite, 0);
    assert.equal(archive.searchGames({ favouritesOnly: true }).total, 0);
    assert.equal(archive.openingFacets({ favouritesOnly: true }).total, 0);
    archive.propertyOptions({ property: 'year', filters: { favouritesOnly: true } });
    assert.deepEqual(readFileSync(path), original, 'Browsing does not modify an archive');
    assert.throws(() => archive.setFavourite(first, 1), /Invalid favourite/);
    assert.throws(() => archive.setFavourite(-1, true), /Invalid record/);
    assert.throws(() => archive.setFavourite(9999, true), /no longer available/);
    assert.deepEqual(readFileSync(path), original, 'Invalid writes do not alter schema');
    assert.equal(archive.setFavourite(first, true), true);
    assert.equal(archive.getGame(first).favourite, 1);
    assert.equal(archive.getGame(second).favourite, 0);
    assert.deepEqual(archive.searchGames({ favouritesOnly: true }).rows.map(row => row.id), [first]);
    assert.equal(archive.searchGames({ favouritesOnly: true, yearFrom: '2010' }).total, 0);
    assert.equal(archive.searchGames({ favouritesOnly: true, search: 'Alice', properties: { year: ['2000'] } }).total, 1);
    assert.equal(archive.openingFacets({ favouritesOnly: true }).total, 1);
    const years = archive.propertyOptions({ property: 'year', filters: { favouritesOnly: true } }).options;
    assert.equal(years.find(option => option.id === '2000').count, 1);
    assert.equal(years.find(option => option.id === '2020').count, 0);
    archive.close(); archive = new ChessArchive(path);
    assert.equal(archive.getGame(first).favourite, 1, 'Favourite survives reopening');
    archive.setFavourite(first, false);
    assert.equal(archive.searchGames({ favouritesOnly: true }).total, 0);
    assert.equal(archive.searchGames().total, 2);
    assert.equal(archive.getGame(first).pgn, pgn);
    // Existing import updates must retain the user preference.
    archive.setFavourite(first, true);
    const writer = new Database(path); upsertGame(writer, { id: first, event: 'Updated event' }); writer.close();
    assert.equal(archive.getGame(first).favourite, 1);
    assert.throws(() => archive.searchGames({ favouritesOnly: 'true' }), /Invalid favourites/);
  } finally { archive?.close(); rmSync(dir, { recursive: true, force: true }); }
});
