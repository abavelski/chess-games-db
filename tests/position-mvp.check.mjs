import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { ChessArchive } from '../electron/database.mjs';
import { buildCatalogue } from '../electron/openings.mjs';
import { enrichOpenings } from '../electron/opening-enrichment.mjs';
import { upsertGame } from '../lib/game-writer.mjs';
import { positionBuildStatus } from '../lib/position-builder.mjs';
import { resolveReviewNavigation } from '../src/review-navigation.mjs';
import { main as positionsCli } from '../scripts/positions.mjs';
import { fixtureArchive, catalogueFiles, hash } from './fixtures/opening-archive.mjs';

function fenAfter(...moves) {
  const chess = Chess.default();
  for (const san of moves) {
    const move = parseSan(chess, san);
    assert.ok(move, san);
    chess.play(move);
  }
  return makeFen(chess.toSetup());
}
const fileHash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const snapshot = db => ({
  version: db.pragma('user_version', { simple: true }),
  games: db.prepare('SELECT id,game_key,pgn_sha256,pgn_zstd,headers_json,extras_json FROM games ORDER BY id').all(),
  sources: db.prepare('SELECT * FROM sources ORDER BY id').all(),
  openings: db.prepare('SELECT * FROM game_openings ORDER BY revision_id,game_id').all(),
  matches: db.prepare('SELECT * FROM game_opening_matches ORDER BY revision_id,game_id,entry_id').all(),
  openingState: db.prepare('SELECT * FROM opening_state').all(),
  features: db.prepare('SELECT * FROM game_features ORDER BY game_id').all(),
  personal: db.prepare('SELECT * FROM game_personal_analysis ORDER BY game_id').all(),
});
test('PS-08 opt-in index on a SQLite backup: filters, transposition, original data, custom FEN, invalid PGN, rebuild', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ps08-archive-'));
  const source = join(directory, 'original.sqlite3');
  const copy = join(directory, 'copy.sqlite3');
  let reader, indexed, dbCopy;
  try {
    const annotated = '1. e4 {Book prose [%crit opening] [%cal Ge2e4]} e5 (1... c5) 2. Nf3 Nc6 *';
    const transposed = '1. Nf3 Nc6 2. e4 e5 *';
    const repeated = '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 *';
    const fenRoot = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    const custom = '[SetUp "1"]\n[FEN "' + fenRoot + '"]\n\n*';
    const pgns = [annotated, transposed, custom, '1. e4 e5 2. Ke9 *',
      repeated, '1. a4 h5 2. Ra3 Rh6 *', '1. d4 d5 2. c4 e6 *',
      '1. e4 e5 2. Nf3 Nc6 *'];
    const sourceDb = fixtureArchive(source, pgns);
    upsertGame(sourceDb, { id: 1, year: 2000 });
    upsertGame(sourceDb, { id: 2, year: 2020 });
    sourceDb.close();
    await enrichOpenings(source, { catalogue: buildCatalogue(catalogueFiles),
      manifest: { commit: 'a'.repeat(40) }, checksum: 'ps08-offline-fixture' });
    reader = new ChessArchive(source);
    reader.setFavourite(2, true);
    const note = { lines: [], comments: [{ moves: [], text: 'Private study reminder' }] };
    reader.savePersonal(2, note);
    assert.equal(reader.positionIndexCapability().status, 'unavailable');
    const beforeBytes = fileHash(source);
    const readOnly = new Database(source, { readonly: true, fileMustExist: true });
    const original = snapshot(readOnly);
    await readOnly.backup(copy);
    readOnly.close();

    // The source remains unindexed even while the copy is installed/built.
    assert.equal((await positionsCli(['status', '--database', copy])).capability, 'unavailable');
    await positionsCli(['init', '--database', copy]);
    assert.equal((await positionsCli(['status', '--database', copy])).unindexed, 8);
    const built = await positionsCli(['build', '--database', copy, '--batch-size', '2']);
    assert.equal(built.complete, 7);
    assert.equal(built.invalid, 1);
    assert.equal(built.coverage.coverage, 'partial', 'invalid PGN coverage is not authoritative zero');
    assert.equal((await positionsCli(['build', '--database', copy])).attempted, 1, 'invalid source is retried; completed inputs are skipped');
    // Failed inputs are retried on incremental builds, so test them separately.
    const status = await positionsCli(['status', '--database', copy]);
    assert.equal(status.complete, 7);
    assert.equal(status.invalid, 1);

    indexed = new ChessArchive(copy);
    const commonFen = fenAfter('e4','e5','Nf3','Nc6');
    const hits = indexed.searchByPosition(commonFen, { pageSize: 20 });
    assert.ok(hits.rows.length >= 3);
    assert.ok(hits.rows.some(row => row.id === 1));
    assert.ok(hits.rows.some(row => row.id === 2), 'transposed game reached the exact board');
    assert.notEqual(hits.rows.find(row => row.id === 1).match.path,
      hits.rows.find(row => row.id === 2).match.path);
    for (const row of hits.rows) {
      const review = resolveReviewNavigation(indexed.getGame(row.id).pgn, row.match, commonFen);
      assert.equal(review.path, row.match.path);
      assert.equal(review.notice, null);
    }
    const family = indexed.openingFacets({}).nodes.find(node => node.label === 'Open Game');
    assert.ok(family, 'offline Lichess opening hierarchy survives indexing');
    assert.ok(indexed.searchByPosition(commonFen, { openingNodeId: family.id }).total >= 2);
    const fav = indexed.searchByPosition(commonFen, { favouritesOnly: true, personalOnly: true,
      yearFrom: '2010', yearTo: '2025', properties: { source: ['1'] } });
    assert.deepEqual(fav.rows.map(row => row.id), [2], 'position search composes source/year/favourite/personal filters');
    assert.deepEqual(indexed.getGame(2).personal, note);
    assert.equal(indexed.getGame(2).favourite, 1);
    assert.ok(indexed.getGame(1).pgn.includes('[%cal Ge2e4]'));
    assert.ok(indexed.getGame(1).critical_position_count > 0);
    assert.ok(indexed.getGame(1).pgn.includes('(1... c5)'));
    assert.equal(indexed.searchByPosition(fenRoot).rows[0].match.path, '');
    assert.equal(indexed.searchByPosition(fenAfter('Nf3','Nf6')).rows
      .find(row => row.id === 5).match.ply, 2);
    assert.equal(indexed.searchByPosition(fenAfter('a4','h5','Ra3','Rh6')).total, 1);
    assert.equal(indexed.searchByPosition(fenAfter('h3')).total, 0);
    assert.equal(indexed.searchByPosition(fenAfter('h3')).coverage.isComplete, false);
    indexed.close(); indexed = null;

    const rebuilt = await positionsCli(['rebuild', '--database', copy]);
    assert.equal(rebuilt.complete, 7);
    dbCopy = new Database(copy, { readonly: true });
    assert.deepEqual(snapshot(dbCopy), original, 'derived indexing leaves PGN, source, opening, features and notes unchanged');
    assert.deepEqual(dbCopy.pragma('foreign_key_check'), []);
    assert.equal(dbCopy.pragma('user_version', { simple: true }), 7);
    dbCopy.close(); dbCopy = null;
    assert.equal(fileHash(source), beforeBytes, 'source archive never modified (not even implicitly)');
    assert.equal(reader.positionIndexCapability().status, 'unavailable');
    assert.equal(reader.searchByPosition(commonFen).coverage.status, 'unavailable');
    assert.equal(fileHash(source), beforeBytes, 'read-only browser must not install index');
  } finally {
    reader?.close(); indexed?.close(); dbCopy?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
