import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeGames, upsertGame, deleteGame } from '../lib/game-writer.mjs';
import { frame, hash } from './fixtures/opening-archive.mjs';
import { installPositionIndex } from '../scripts/position-index.mjs';
import { main as positionsCli } from '../scripts/positions.mjs';
import { buildPositions, cleanOrphanPositions, positionBuildStatus,
  POSITION_INDEXER_VERSION } from '../lib/position-builder.mjs';

const game = (pgn, extra = {}) => ({
  white: 'White', black: 'Black', pgn_zstd: frame(pgn), pgn_sha256: hash(pgn),
  ...extra,
});
async function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'positions-builder-'));
  const path = join(directory, 'fixture.sqlite3');
  const db = new Database(path);
  try {
    initializeGames(db);
    await run(db, path);
  } finally {
    db.close();
    rmSync(directory, { force: true, recursive: true });
  }
}
const count = (db, table) => db.prepare('SELECT count(*) AS n FROM ' + table).get().n;
const occurrences = db => db.prepare(
  'SELECT o.game_id,o.path,o.ply,k.exact_key FROM game_position_occurrences o' +
  ' JOIN position_keys k ON k.id=o.position_id ORDER BY o.game_id,o.path'
).all();
const state = (db, id) => db.prepare('SELECT * FROM game_position_index_state WHERE game_id=?').get(id);

test('offline fixture: install, bounded resume, repeat, rebuild and exact source preservation', () =>
  fixture(async (db, path) => {
    const id1 = upsertGame(db, game('1. Nf3 d5 2. g3 *'));
    const id2 = upsertGame(db, game('1. g3 d5 2. Nf3 *', { white: 'Second edition' }));
    const original = db.prepare('SELECT id,pgn_zstd,pgn_sha256,game_key FROM games ORDER BY id').all();
    assert.deepEqual(positionBuildStatus(db).coverage, 'unavailable');
    assert.equal((await positionsCli(['status', '--database', path])).capability, 'unavailable');
    assert.equal((await positionsCli(['init', '--database', path, '--dry-run'])).current, 'unavailable');
    assert.equal(positionBuildStatus(db).capability, 'unavailable');
    await positionsCli(['init', '--database', path]);
    assert.equal(positionBuildStatus(db).unindexed, 2);
    const first = await buildPositions(db, { maxGames: 1, batchSize: 1 });
    assert.equal(first.attempted, 1);
    assert.equal(first.complete, 1);
    assert.equal(positionBuildStatus(db).coverage, 'partial');
    assert.equal(state(db, id1).indexer_version, POSITION_INDEXER_VERSION);
    assert.equal(state(db, id2), undefined);
    assert.equal(count(db, 'game_position_occurrences'), 4);
    const resumed = await buildPositions(db, { batchSize: 1 });
    assert.equal(resumed.skipped, 1);
    assert.equal(resumed.attempted, 1);
    assert.equal(resumed.complete, 1);
    assert.equal(positionBuildStatus(db).coverage, 'complete');
    assert.equal(positionBuildStatus(db).occurrences, 8);
    assert.equal(positionBuildStatus(db).invalid, 0);
    assert.equal(positionBuildStatus(db).stale, 0);
    assert.equal(positionBuildStatus(db).unindexed, 0);
    const before = occurrences(db);
    const repeat = await buildPositions(db);
    assert.equal(repeat.attempted, 0);
    assert.equal(repeat.skipped, 2);
    assert.deepEqual(occurrences(db), before);
    const rebuilt = await positionsCli(['rebuild', '--database', path, '--batch-size', '1']);
    assert.equal(rebuilt.complete, 2);
    assert.deepEqual(occurrences(db), before);
    assert.deepEqual(db.prepare('SELECT id,pgn_zstd,pgn_sha256,game_key FROM games ORDER BY id').all(), original);
    assert.equal(db.pragma('user_version', { simple: true }), 7);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(count(db, 'position_keys'), 6, 'root and transposed final are deduplicated');
  }));

test('dry-run and interruption never publish incomplete or partial game rows', () =>
  fixture(async db => {
    installPositionIndex(db);
    const valid = [1, 2, 3].map(n => upsertGame(db, game('1. e4 e5 2. Nf3 *', { white: 'Edition ' + n })));
    const preview = await buildPositions(db, { dryRun: true, maxGames: 2 });
    assert.equal(preview.attempted, 2);
    assert.equal(count(db, 'game_position_index_state'), 0);
    assert.equal(count(db, 'position_keys'), 0);
    let stopped = false;
    const partial = await buildPositions(db, {
      batchSize: 1, shouldStop: () => stopped, onProgress: () => { stopped = true; },
    });
    assert.equal(partial.stopped, true);
    assert.equal(partial.complete, 1);
    assert.equal(positionBuildStatus(db).unindexed, 2);
    assert.equal(count(db, 'game_position_index_state'), 1);
    assert.equal(state(db, valid[0]).status, 'complete');
    assert.equal(state(db, valid[1]), undefined);
    await buildPositions(db);
    assert.equal(positionBuildStatus(db).complete, 3);
  }));

test('checksum failures, malformed PGNs, hidden games and annotated editions are diagnosed', () =>
  fixture(async db => {
    installPositionIndex(db);
    const good = upsertGame(db, game('1. e4 {Long comment '.repeat(1) +
      'word '.repeat(3000) + '} (1. d4 (1. c4) d5) e5 *',
      { white: 'Annotated edition' }), { derive: false });
    const other = upsertGame(db, game('1. e4 e5 *', { white: 'Other edition', hidden: 1 }));
    const malformed = upsertGame(db, game('1. e4 e5 2. Bh6 *'), { derive: false });
    const corrupt = upsertGame(db, game('1. d4 *'), { derive: false });
    // Direct corruption changes the hash; PS-02 trigger invalidates any old occurrences.
    db.prepare('UPDATE games SET pgn_sha256=? WHERE id=?').run(hash('1. e4 *'), corrupt);
    const result = await buildPositions(db, { batchSize: 2 });
    assert.equal(result.complete, 2);
    assert.equal(result.invalid, 2);
    assert.equal(state(db, good).status, 'complete');
    assert.equal(state(db, other).status, 'complete', 'hidden provenance is indexed, not displayed by the normal browser');
    assert.equal(state(db, malformed).status, 'failed');
    assert.match(state(db, malformed).diagnostic, /Illegal|Malformed|move/i);
    assert.match(state(db, corrupt).diagnostic, /SHA-256/);
    assert.equal(db.prepare('SELECT count(*) n FROM game_position_occurrences WHERE game_id IN (?,?)')
      .get(malformed, corrupt).n, 0);
    assert.equal(positionBuildStatus(db).invalid, 2);
    assert.equal(positionBuildStatus(db).hidden, 1);
    assert.equal(positionBuildStatus(db).coverage, 'partial');
  }));

test('changed-PGN importer invalidates, unchanged metadata reimport retains, deletion cascades', () =>
  fixture(async db => {
    installPositionIndex(db);
    const id = upsertGame(db, game('1. e4 *', {
      sources: [{ source: { source_key: 'source', title: 'Old title' }, source_game_key: 'one' }],
    }));
    const edition = upsertGame(db, game('1. e4 *', { white: 'Another annotated edition' }));
    await buildPositions(db);
    const untouched = state(db, edition);
    const oldPaths = occurrences(db).filter(row => row.game_id === id);
    upsertGame(db, { id, sources: [{ source: { source_key: 'source', title: 'Renamed source' }, source_game_key: 'one' }] });
    assert.deepEqual(occurrences(db).filter(row => row.game_id === id), oldPaths);
    assert.equal(state(db, id).status, 'complete');
    upsertGame(db, { id, pgn_zstd: frame('1. d4 *'), pgn_sha256: hash('1. d4 *') }, { derive: false });
    assert.equal(state(db, id).status, 'stale');
    assert.equal(positionBuildStatus(db).stale, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM game_position_occurrences WHERE game_id=?').get(id).n, 0);
    assert.equal(state(db, edition).status, untouched.status);
    await buildPositions(db);
    assert.equal(state(db, id).status, 'complete');
    assert.equal(positionBuildStatus(db).complete, 2);
    deleteGame(db, id);
    assert.equal(state(db, id), undefined);
    assert.equal(positionBuildStatus(db).total, 1);
    assert.equal(state(db, edition).status, 'complete');
    assert.equal(cleanOrphanPositions(db) >= 0, true);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  }));

test('SQL failure while rebuilding rolls back entire game and keeps previous searchable result', () =>
  fixture(async db => {
    installPositionIndex(db);
    const id = upsertGame(db, game('1. e4 e5 *'));
    await buildPositions(db);
    const before = occurrences(db);
    const saved = state(db, id);
    db.exec("CREATE TRIGGER fail_position_write BEFORE INSERT ON game_position_occurrences " +
      "BEGIN SELECT RAISE(ABORT, 'injected position write failure'); END");
    await assert.rejects(buildPositions(db, { rebuild: true, batchSize: 1 }), /injected position write failure/);
    assert.deepEqual(occurrences(db), before);
    assert.deepEqual(state(db, id), saved);
    db.exec('DROP TRIGGER fail_position_write');
    assert.equal((await buildPositions(db, { rebuild: true })).complete, 1);
  }));

test('CLI refuses missing archives, unsupported modes and build without explicit extension', () =>
  fixture(async (db, path) => {
    await assert.rejects(positionsCli(['build', '--database', path]), /run npm run positions -- init/);
    await assert.rejects(positionsCli(['build', '--database', path, '--batch-size', '0']), /positive/);
    await assert.rejects(positionsCli(['status']), /Usage/);
    await assert.rejects(positionsCli(['build', '--database', join(tmpdir(), 'no-positions-archive.sqlite3')]), /open/i);
    assert.equal(positionBuildStatus(db).capability, 'unavailable');
  }));
