import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { ChessArchive } from '../electron/database.mjs';
import { fixtureArchive, frame, hash } from './fixtures/opening-archive.mjs';
import { upsertGame } from '../lib/game-writer.mjs';
import { installPositionIndex } from '../scripts/position-index.mjs';
import { main as positionsCli } from '../scripts/positions.mjs';
import { buildPositions, positionBuildStatus, POSITION_INDEXER_VERSION,
  ALL_POSITION_INDEXER_VERSION } from '../lib/position-builder.mjs';
import { positionFingerprint } from '../lib/position-hash.mjs';

function fenAfter(...sans) {
  const position = Chess.default();
  for (const san of sans) {
    const move = parseSan(position, san);
    assert.ok(move, 'legal SAN: ' + san);
    position.play(move);
  }
  return makeFen(position.toSetup());
}
const occurrences = (db, gameId) => db.prepare(
  'SELECT o.path,o.ply,o.is_mainline,k.exact_key,CAST(k.pawn_hash AS TEXT) AS pawn_hash,k.pawn_signature' +
  ' FROM game_position_occurrences o JOIN position_keys k ON k.id=o.position_id' +
  ' WHERE game_id=? ORDER BY o.path'
).all(gameId);

test('PS-09 offline CLI upgrades mainline-only state without changing mainline search, sources or personal notes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps09-'));
  const path = join(dir, 'archive.sqlite3');
  const good = '1. Nf3 (1. d4 d5 (1... Nf6)) Nf6 2. g3 g6 *';
  const invalid = '1. e4 e5 (1... Ke9) 2. Nf3 Nc6 *';
  const custom = '[SetUp "1"]\n[FEN "4k3/P7/8/8/8/8/8/4K3 w - - 0 15"]\n\n15. a8=Q+ (15. a8=N) *';
  let db, archive;
  try {
    db = fixtureArchive(path, [good, invalid, custom, '1. e4 e5 *']);
    const original = db.prepare('SELECT id,pgn_sha256,pgn_zstd FROM games ORDER BY id').all();
    archive = new ChessArchive(path);
    const notes = { lines: [], comments: [{ moves: [], text: 'My private line, not source PGN' }] };
    archive.savePersonal(1, notes);
    archive.setFavourite(1, true);
    installPositionIndex(db);
    const main = await buildPositions(db);
    assert.equal(main.complete, 4);
    const mainlineRows = occurrences(db, 1);
    assert.ok(mainlineRows.every(row => row.is_mainline === 1));
    assert.equal(archive.searchByPosition(fenAfter('d4')).total, 0, 'old API does not search annotations');
    assert.equal(positionBuildStatus(db).allComplete, 0);

    const upgraded = await positionsCli(['build', '--database', path, '--include-variations', '--batch-size', '2']);
    assert.equal(upgraded.attempted, 4);
    assert.equal(upgraded.complete, 4, 'invalid variation retains valid mainline');
    assert.equal(upgraded.variationIncomplete, 1);
    assert.equal(positionBuildStatus(db).coverage, 'complete', 'mainline coverage remains complete');
    assert.equal(positionBuildStatus(db).allComplete, 3);
    assert.equal(positionBuildStatus(db).variationIncomplete, 1);
    const state = db.prepare('SELECT scope,indexer_version,status,diagnostic FROM game_position_index_state WHERE game_id=?');
    assert.deepEqual(state.get(1).scope, 'all');
    assert.equal(state.get(1).indexer_version, ALL_POSITION_INDEXER_VERSION);
    assert.equal(state.get(2).scope, 'mainline');
    assert.equal(state.get(2).indexer_version, POSITION_INDEXER_VERSION);
    assert.match(state.get(2).diagnostic, /Variation indexing incomplete/);
    assert.ok(occurrences(db, 1).some(row => !row.is_mainline));
    assert.ok(occurrences(db, 3).some(row => !row.is_mainline), 'custom-FEN promotion variation indexed');
    assert.ok(occurrences(db, 2).length > 0, 'a malformed sideline must retain verified mainline hits');
    assert.ok(occurrences(db, 2).every(row => row.is_mainline), 'malformed sideline never published');
    const d4 = occurrences(db, 1).find(row => !row.is_mainline && row.ply === 1);
    assert.equal(d4.exact_key, positionFingerprint(fenAfter('d4')).verificationKey);
    assert.equal(d4.pawn_signature, positionFingerprint(fenAfter('d4')).pawnSignature);
    assert.equal(BigInt(d4.pawn_hash), positionFingerprint(fenAfter('d4')).sqlitePawnHash);
    // PS-10 will expose the all-lines UI/API. PS-09 must not leak variations.
    assert.equal(archive.searchByPosition(fenAfter('d4')).total, 0);
    assert.equal(archive.searchByPosition(fenAfter('Nf3','Nf6','g3','g6')).total, 1);
    assert.equal(archive.searchByPosition(fenAfter('e4','e5')).total, 2);
    assert.equal(archive.searchByPosition(fenAfter('e4','e5')).coverage.isComplete, true);
    assert.equal((await buildPositions(db)).skipped, 4, 'default rerun does not downgrade the all-scope index');
    const repeat = await buildPositions(db, { includeVariations: true });
    assert.equal(repeat.skipped, 3);
    assert.equal(repeat.variationIncomplete, 1);
    const beforeRebuild = occurrences(db, 1);
    await positionsCli(['rebuild', '--database', path, '--include-variations']);
    assert.deepEqual(occurrences(db, 1), beforeRebuild, 'rebuild is deterministic and idempotent');
    assert.deepEqual(db.prepare('SELECT id,pgn_sha256,pgn_zstd FROM games ORDER BY id').all(), original);
    assert.deepEqual(archive.getGame(1).personal, notes);
    assert.equal(archive.getGame(1).favourite, 1);
    assert.equal(db.pragma('user_version', { simple: true }), 7);
    assert.deepEqual(db.pragma('foreign_key_check'), []);

    const previous = occurrences(db, 1);
    upsertGame(db, { id: 1, pgn_zstd: frame('1. c4 *'), pgn_sha256: hash('1. c4 *') }, { derive: false });
    assert.equal(db.prepare('SELECT status FROM game_position_index_state WHERE game_id=1').get().status, 'stale');
    assert.equal(occurrences(db, 1).length, 0);
    const refreshed = await buildPositions(db, { includeVariations: true });
    assert.equal(refreshed.complete, 2, 'changed PGN and previously bad sideline retried');
    assert.notDeepEqual(occurrences(db, 1), previous);
    assert.equal(archive.searchByPosition(fenAfter('c4')).total, 1);
    assert.equal(archive.searchByPosition(fenAfter('d4')).total, 0);
    assert.equal(archive.getGame(1).personal.comments[0].text, notes.comments[0].text);
    assert.equal(db.pragma('user_version', { simple: true }), 7);
    await assert.rejects(positionsCli(['status', '--database', path, '--include-variations']), /flags|require/);
  } finally {
    archive?.close();
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PS-09 all-scope can be previewed without writes and old mainline-only coverage is never all-complete', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps09-preview-'));
  const path = join(dir, 'db.sqlite3');
  let db;
  try {
    db = fixtureArchive(path, ['1. e4 (1. d4 d5) e5 *']);
    installPositionIndex(db);
    await buildPositions(db);
    const previous = occurrences(db, 1);
    const preview = await buildPositions(db, { dryRun: true, includeVariations: true });
    assert.equal(preview.attempted, 1);
    assert.deepEqual(occurrences(db, 1), previous);
    assert.equal(positionBuildStatus(db).allComplete, 0);
    await positionsCli(['build', '--database', path, '--include-variations']);
    assert.equal(positionBuildStatus(db).allComplete, 1);
    assert.equal((await buildPositions(db, { includeVariations: true })).attempted, 0);
    assert.ok(occurrences(db, 1).length > previous.length);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
