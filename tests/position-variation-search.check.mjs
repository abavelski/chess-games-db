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
import { fixtureArchive } from './fixtures/opening-archive.mjs';
import { installPositionIndex } from '../scripts/position-index.mjs';
import { buildPositions } from '../lib/position-builder.mjs';
import { extractAllPositions } from '../lib/position-mainline.mjs';
import { positionFingerprint } from '../lib/position-hash.mjs';

const scope = { scope: 'includeSourceVariations' };
function fenAfter(...sans) {
  const chess = Chess.default();
  for (const san of sans) {
    const move = parseSan(chess, san);
    assert.ok(move, san);
    chess.play(move);
  }
  return makeFen(chess.toSetup());
}

test('PS-10 mainline-only, complete all-lines, partial author coverage, deduplication and filtering', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ps10-'));
  const path = join(directory, 'games.sqlite3');
  // The first game plays d4, but both alternative routes return to exactly
  // the same d4 position. A separate game reaches d4 only in the author notes.
  const both = '1. d4 (1. Nf3 Nf6 2. Ng1 Ng8 3. d4) (1. Nh3 Nh6 2. Ng1 Ng8 3. d4) d5 *';
  const branch = '1. Nf3 (1. d4 d5 (1... Nf6)) Nf6 2. g3 g6 *';
  const played = '1. d4 d5 2. c4 *';
  const malformed = '1. e4 e5 (1... Ke9) 2. Nf3 Nc6 *';
  let db, archive;
  try {
    db = fixtureArchive(path, [both, branch, played, malformed]);
    archive = new ChessArchive(path);
    const d4 = fenAfter('d4');
    const absent = archive.searchByPosition(d4, scope);
    assert.equal(absent.coverage.status, 'unavailable');
    assert.equal(absent.coverage.scope, scope.scope);
    assert.equal(absent.coverage.isComplete, false);
    assert.equal(absent.total, 0);

    installPositionIndex(db);
    await buildPositions(db);
    assert.equal(archive.searchByPosition(d4).coverage.status, 'complete');
    assert.equal(archive.searchByPosition(d4).total, 2, 'MVP still considers played moves only');
    const onlyMainline = archive.searchByPosition(d4, scope);
    assert.equal(onlyMainline.coverage.status, 'partial');
    assert.equal(onlyMainline.coverage.complete, 0);
    assert.equal(onlyMainline.coverage.mainlineOnly, 4);
    assert.equal(onlyMainline.total, 2, 'known played hits remain visible but not exhaustive');
    assert.ok(onlyMainline.rows.every(row => row.match.type === 'playedGame'));

    await buildPositions(db, { includeVariations: true });
    const main = archive.searchByPosition(d4);
    assert.equal(main.total, 2);
    assert.equal(main.coverage.status, 'complete');
    const all = archive.searchByPosition(d4, scope);
    assert.equal(all.total, 3, 'count distinct games regardless of repeated branch occurrences');
    assert.deepEqual(all.rows.map(row => row.id), [1, 2, 3]);
    assert.equal(all.coverage.status, 'partial', 'an illegal author variation makes all-lines incomplete');
    assert.equal(all.coverage.scope, 'includeSourceVariations');
    assert.equal(all.coverage.complete, 3);
    assert.equal(all.coverage.mainlineOnly, 1);
    assert.equal(all.coverage.isComplete, false);
    assert.deepEqual(all.rows.map(row => row.match.type), ['playedGame', 'sourceVariation', 'playedGame']);
    assert.equal(all.rows[0].match.ply, 1, 'prefer mainline over two alternate occurrences');
    const chosen = extractAllPositions(branch);
    assert.equal(chosen.status, 'complete');
    const variation = chosen.occurrences.find(o => o.verificationKey === positionFingerprint(d4).verificationKey);
    assert.ok(variation && variation.is_mainline === 0);
    assert.equal(all.rows[1].match.path, variation.path);
    assert.equal(all.rows[1].match.ply, variation.ply);
    assert.equal(archive.searchByPosition(fenAfter('d4', 'Nf6'), scope).total, 1,
      'nested authored branch is searchable');

    const paged = archive.searchByPosition(d4, { ...scope, sort: 'newest', pageSize: 1, page: 2 });
    assert.equal(paged.total, 3);
    assert.deepEqual(paged.rows.map(row => row.id), [2]);
    assert.equal(paged.rows[0].match.type, 'sourceVariation');
    assert.equal(archive.searchByPosition(d4, { ...scope, pageSize: 1, page: 4 }).rows.length, 0);
    assert.equal(archive.searchByPosition(d4, { ...scope, yearFrom: '9999' }).total, 0);
    assert.equal(archive.searchByPosition(d4, { ...scope, search: 'White 1' }).total, 1);
    archive.setFavourite(2, true);
    assert.deepEqual(archive.searchByPosition(d4, { ...scope, favouritesOnly: true }).rows.map(r => r.id), [2]);
    assert.equal(archive.searchByPosition(fenAfter('e4'), scope).total, 1,
      'mainline from a game with invalid variations is still usable');
    assert.throws(() => archive.searchByPosition(d4, { scope: 'all' }), /scope/);
    assert.throws(() => archive.searchByPosition(d4, { scope: true }), /scope/);

    db.prepare("UPDATE game_position_index_state SET status='building',completed_at=NULL WHERE game_id=2").run();
    const partial = archive.searchByPosition(d4, scope);
    assert.equal(partial.total, 2, 'non-complete entries never leak hits');
    assert.equal(partial.coverage.building, 1);
    assert.equal(partial.coverage.complete, 2);
    assert.equal(partial.coverage.mainlineOnly, 1);
    assert.equal(archive.searchByPosition(d4).coverage.isComplete, false);
    await buildPositions(db, { includeVariations: true });
    assert.equal(archive.searchByPosition(d4, scope).total, 3);
    assert.equal(db.pragma('user_version', { simple: true }), 7);
  } finally {
    archive?.close();
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('PS-10 complete all-variation archive reports authoritative zero and mainline preference', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ps10-full-'));
  const path = join(directory, 'games.sqlite3');
  let db, archive;
  try {
    db = fixtureArchive(path, [
      '1. d4 (1. Nf3 Nf6 2. Ng1 Ng8 3. d4) (1. Nh3 Nh6 2. Ng1 Ng8 3. d4) d5 *',
      '1. Nf3 (1. d4 d5) Nf6 *',
    ]);
    archive = new ChessArchive(path);
    installPositionIndex(db);
    await buildPositions(db, { includeVariations: true });
    const all = archive.searchByPosition(fenAfter('d4'), scope);
    assert.equal(all.coverage.status, 'complete');
    assert.equal(all.coverage.isComplete, true);
    assert.equal(all.coverage.complete, 2);
    assert.equal(all.coverage.mainlineOnly, 0);
    assert.equal(all.total, 2);
    assert.equal(all.rows[0].match.isMainline, true);
    assert.equal(all.rows[0].match.ply, 1);
    assert.equal(archive.searchByPosition(fenAfter('e4'), scope).total, 0);
    assert.equal(archive.searchByPosition(fenAfter('e4'), scope).coverage.isComplete, true);
    assert.equal(archive.searchByPosition(fenAfter('d4')).total, 1);
  } finally {
    archive?.close();
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
