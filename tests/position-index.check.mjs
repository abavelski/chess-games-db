import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { Chess } from 'chessops/chess';
import { ChessArchive } from '../electron/database.mjs';
import { initializeGames, upsertGame, deleteGame } from '../lib/game-writer.mjs';
import { positionFingerprint, fromSqliteInt64 } from '../lib/position-hash.mjs';
import { positionIndexCapability } from '../lib/position-index-storage.mjs';
import { installPositionIndex, main } from '../scripts/position-index.mjs';
import { frame, hash } from './fixtures/opening-archive.mjs';

const game = (pgn = '1. e4 *', extra = {}) => ({
  pgn_zstd: frame(pgn), pgn_sha256: hash(pgn), white: 'Alpha', black: 'Beta', ...extra,
});
const queryVisible = (db, gameId) => db.prepare(
  'SELECT id,path,ply FROM searchable_game_position_occurrences WHERE game_id=? ORDER BY ply,path',
).all(gameId);
const state = (db, id, sha, status = 'complete', options = {}) => db.prepare(
  'INSERT INTO game_position_index_state(game_id,pgn_sha256,algorithm_id,indexer_version,scope,status,diagnostic,completed_at) VALUES(?,?,?,?,?,?,?,?)',
).run(id, sha, options.algorithm ?? 'polyglot-standard-v1', options.version ?? 'ps-test-v1',
  options.scope ?? 'mainline', status, options.diagnostic ?? null,
  status === 'complete' ? '2026-10-21T00:00:00Z' : null);
const position = (db, fp) => Number(db.prepare(
  'INSERT INTO position_keys(zobrist_hash,exact_key,pawn_hash,pawn_signature) VALUES(?,?,?,?)',
).run(fp.sqliteHash, fp.verificationKey, fp.sqlitePawnHash, fp.pawnSignature).lastInsertRowid);
const occurrence = (db, gameId, positionId, path = '', ply = 0, mainline = 1) => db.prepare(
  'INSERT INTO game_position_occurrences(game_id,position_id,path,ply,is_mainline) VALUES(?,?,?,?,?)',
).run(gameId, positionId, path, ply, mainline);

function fixture(run, { baseOnly = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'position-index-'));
  const path = join(directory, 'archive.sqlite3');
  let db;
  try {
    db = new Database(path);
    if (baseOnly) {
      db.exec(readFileSync(new URL('../db/migrations/007_games.sql', import.meta.url), 'utf8'));
      db.pragma('user_version=7');
      db.pragma('foreign_keys=ON');
    } else initializeGames(db);
    run({ db, path });
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const baseOnly of [false, true]) {
  test('explicit PS-02 install, idempotency and read-only archive compatibility (' +
      (baseOnly ? 'pre-008 v7 archive' : 'fresh v7 archive') + ')', () => fixture(({ db, path }) => {
    const id = upsertGame(db, game());
    if (!baseOnly) {
      db.prepare('INSERT INTO game_personal_analysis(game_id,data_json) VALUES (?,?)')
        .run(id, '{"lines":[],"comments":[{"moves":[],"text":"personal"}]}');
    }
    assert.equal(positionIndexCapability(db).status, 'unavailable');
    const initial = readFileSync(path);
    const reader = new ChessArchive(path);
    assert.equal(reader.catalog().capabilities.positionIndex.status, 'unavailable');
    assert.equal(reader.getGame(id).pgn, '1. e4 *');
    reader.close();
    assert.deepEqual(readFileSync(path), initial, 'normal opening cannot auto-install extension');
    assert.equal(db.pragma('user_version', { simple: true }), 7);
    assert.equal(installPositionIndex(db).newlyInstalled, true);
    assert.equal(installPositionIndex(db).newlyInstalled, false);
    assert.equal(db.pragma('user_version', { simple: true }), 7);
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.deepEqual(positionIndexCapability(db), {
      status: 'installed', schemaVersion: 1,
      hashAlgorithm: 'polyglot-standard-v1', pawnAlgorithm: 'polyglot-pawns-v1',
    });
    const beforeRead = readFileSync(path);
    const reopened = new ChessArchive(path);
    assert.equal(reopened.catalog().capabilities.positionIndex.status, 'installed');
    assert.equal(reopened.searchGames().total, 1);
    assert.equal(reopened.getGame(id).pgn, '1. e4 *');
    if (!baseOnly) assert.equal(reopened.getGame(id).personal.comments[0].text, 'personal');
    reopened.close();
    assert.deepEqual(readFileSync(path), beforeRead, 'read-only discovery does not mutate extension');
    assert.equal(db.prepare('SELECT count(*) n FROM game_position_index_state').get().n, 0,
      'install does not falsely claim game coverage');
    assert.equal(db.prepare('SELECT count(*) n FROM position_keys').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM opening_revisions').get().n, 0);
  }, { baseOnly }));
}

test('exact hash/pawn indexes, collision-safe keys, paths, status and FK constraints', () =>
  fixture(({ db }) => {
    const game1 = game('1. e4 *');
    const id1 = upsertGame(db, game1);
    const id2 = upsertGame(db, game('1. e4 *', { white: 'Second edition' }));
    installPositionIndex(db);
    const fp = positionFingerprint(Chess.default());
    const startId = position(db, fp);
    const forged = { ...fp, verificationKey: fp.verificationKey.replace(' w ', ' b ') };
    const otherId = position(db, forged);
    assert.notEqual(otherId, startId);
    assert.throws(() => position(db, fp), /UNIQUE/);
    const exactRows = db.prepare(
      'SELECT id,zobrist_hash,pawn_hash,exact_key FROM position_keys WHERE zobrist_hash=? AND exact_key=?',
    ).safeIntegers().all(fp.sqliteHash, fp.verificationKey);
    assert.equal(exactRows.length, 1);
    assert.equal(exactRows[0].id, BigInt(startId));
    assert.equal(typeof exactRows[0].zobrist_hash, 'bigint');
    assert.equal(fromSqliteInt64(exactRows[0].zobrist_hash), fp.hash);
    assert.equal(fromSqliteInt64(exactRows[0].pawn_hash), fp.pawnHash);
    assert.equal(db.prepare('SELECT count(*) n FROM position_keys WHERE pawn_hash=? AND pawn_signature=?')
      .get(fp.sqlitePawnHash, fp.pawnSignature).n, 2);
    assert.throws(() => db.prepare(
      'INSERT INTO position_keys(zobrist_hash,exact_key,pawn_hash,pawn_signature) VALUES(?,?,?,?)',
    ).run(1n, 'invalid', 2n, 'invalid'), /CHECK/);

    state(db, id1, game1.pgn_sha256);
    state(db, id2, game1.pgn_sha256, 'partial');
    occurrence(db, id1, startId);
    occurrence(db, id1, otherId, 'a1', 1, 0);
    occurrence(db, id2, startId);
    assert.throws(() => occurrence(db, id1, startId), /UNIQUE/);
    assert.throws(() => occurrence(db, id1, startId, '', 1), /CHECK|UNIQUE/);
    assert.throws(() => occurrence(db, 999999, startId, 'x1', 1), /FOREIGN KEY/);
    assert.throws(() => occurrence(db, id1, 999999, 'x2', 1), /FOREIGN KEY/);
    assert.throws(() => state(db, 999999, game1.pgn_sha256), /FOREIGN KEY/);
    assert.deepEqual(queryVisible(db, id1).map(row => row.path), ['', 'a1']);
    assert.deepEqual(queryVisible(db, id2), [], 'partial rows must not be visible');
    db.prepare("UPDATE game_position_index_state SET status='complete',completed_at=CURRENT_TIMESTAMP WHERE game_id=?").run(id2);
    assert.equal(queryVisible(db, id2).length, 1, 'different editions remain separate');
    for (const status of ['building', 'failed', 'stale', 'partial']) {
      db.prepare('UPDATE game_position_index_state SET status=?,completed_at=NULL WHERE game_id=?').run(status, id1);
      assert.equal(queryVisible(db, id1).length, 0, status);
    }
    db.prepare("UPDATE game_position_index_state SET status='complete',completed_at=CURRENT_TIMESTAMP WHERE game_id=?").run(id1);
    db.prepare("UPDATE game_position_index_state SET pgn_sha256=? WHERE game_id=?")
      .run('0'.repeat(64), id1);
    assert.equal(queryVisible(db, id1).length, 0, 'old input digest is never a hit');
    db.prepare('UPDATE game_position_index_state SET pgn_sha256=? WHERE game_id=?')
      .run(game1.pgn_sha256, id1);
    db.prepare("UPDATE game_position_index_state SET algorithm_id='other-standard' WHERE game_id=?").run(id1);
    assert.equal(queryVisible(db, id1).length, 0, 'unsupported algorithm cannot be a hit');
    assert.equal(db.pragma('foreign_key_check').length, 0);

    const plans = [
      ['SELECT id FROM position_keys WHERE zobrist_hash=? AND exact_key=?', [fp.sqliteHash, fp.verificationKey], 'SEARCH position_keys USING COVERING INDEX'],
      ['SELECT id FROM position_keys WHERE pawn_hash=? AND pawn_signature=?', [fp.sqlitePawnHash, fp.pawnSignature], 'position_keys_pawn_lookup'],
      ['SELECT game_id FROM game_position_occurrences INDEXED BY game_position_occurrences_position WHERE position_id=? AND is_mainline=1', [startId], 'game_position_occurrences_position'],
      ['SELECT position_id FROM game_position_occurrences INDEXED BY game_position_occurrences_game WHERE game_id=? AND is_mainline=1', [id1], 'game_position_occurrences_game'],
    ];
    for (const [sql, params, expected] of plans) {
      const explanation = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params)
        .map(row => row.detail).join(' | ');
      assert.match(explanation, new RegExp(expected), sql + ' => ' + explanation);
    }
  }));

test('PGN reimport invalidates occurrences transactionally; deletion cascades but preserves editions', () =>
  fixture(({ db }) => {
    installPositionIndex(db);
    const id1 = upsertGame(db, game('1. e4 *', {
      sources: [{ source: { source_key: 'book', title: 'Original source' }, source_game_key: 'game-1', is_primary: true }],
    }));
    const id2 = upsertGame(db, game('1. e4 *', { white: 'Independent annotated edition' }));
    const fingerprint = positionFingerprint(Chess.default());
    const keyId = position(db, fingerprint);
    state(db, id1, hash('1. e4 *'));
    state(db, id2, hash('1. e4 *'));
    for (const id of [id1, id2]) occurrence(db, id, keyId);
    const before = db.prepare('SELECT pgn_sha256,pgn_zstd,game_key FROM games WHERE id=?').get(id1);
    upsertGame(db, { id: id1, year: 2020 });
    assert.equal(queryVisible(db, id1).length, 1, 'metadata-only update retains valid index');
    assert.equal(db.prepare('SELECT status FROM game_position_index_state WHERE game_id=?').get(id1).status, 'complete');

    assert.throws(() => db.transaction(() => {
      db.prepare('UPDATE games SET pgn_sha256=? WHERE id=?').run('a'.repeat(64), id1);
      assert.equal(queryVisible(db, id1).length, 0);
      throw new Error('abort');
    })(), /abort/);
    assert.equal(queryVisible(db, id1).length, 1, 'rollback restores occurrences and state');

    upsertGame(db, { id: id1, pgn_zstd: frame('1. d4 *'), pgn_sha256: hash('1. d4 *') });
    assert.equal(queryVisible(db, id1).length, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM game_position_occurrences WHERE game_id=?').get(id1).n, 0);
    const row = db.prepare('SELECT status,completed_at,diagnostic,pgn_sha256 FROM game_position_index_state WHERE game_id=?').get(id1);
    assert.equal(row.status, 'stale');
    assert.equal(row.completed_at, null);
    assert.equal(row.pgn_sha256, before.pgn_sha256, 'retain stale input hash for diagnostics');
    assert.match(row.diagnostic, /PGN changed/);
    assert.equal(queryVisible(db, id2).length, 1, 'other annotated edition is untouched');
    assert.equal(db.prepare('SELECT count(*) n FROM game_sources WHERE game_id=?').get(id1).n, 1);
    assert.equal(db.prepare('SELECT game_key FROM games WHERE id=?').get(id1).game_key, before.game_key);
    assert.notDeepEqual(db.prepare('SELECT pgn_zstd FROM games WHERE id=?').get(id1).pgn_zstd, before.pgn_zstd);
    deleteGame(db, id1);
    assert.equal(db.prepare('SELECT count(*) n FROM game_position_index_state WHERE game_id=?').get(id1).n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM game_position_occurrences WHERE game_id=?').get(id1).n, 0);
    assert.equal(queryVisible(db, id2).length, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM position_keys WHERE id=?').get(keyId).n, 1,
      'shared position key survives deletion');
    assert.equal(db.pragma('foreign_key_check').length, 0);
  }));

test('CLI refuses missing, future-version and partial archives without migrating them', () =>
  fixture(({ db, path }) => {
    assert.throws(() => main(['install', '--database', join(tmpdir(), 'not-a-real-archive-ps02.sqlite3')]), /open|exist/i);
    assert.throws(() => main(['install', '--database', path, '--bad-option']), /Unknown option/);
    db.exec('CREATE TABLE position_keys(dummy INTEGER)');
    assert.equal(positionIndexCapability(db).status, 'incompatible');
    assert.throws(() => installPositionIndex(db), /Incompatible/);
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='game_position_occurrences'").get().n, 0);
    assert.equal(db.pragma('user_version', { simple: true }), 7);
    db.exec('DROP TABLE position_keys');
    db.pragma('user_version=8');
    assert.throws(() => installPositionIndex(db), /Schema 7/);
    assert.throws(() => new ChessArchive(path), /schema 7/);
    assert.equal(positionIndexCapability(db).status, 'unavailable');
  }));

test('explicit archive-tool CLI executable installs once and refuses repeat changes', () =>
  fixture(({ db, path }) => {
    const script = fileURLToPath(new URL('../scripts/position-index.mjs', import.meta.url));
    const run = () => spawnSync(process.execPath, [script, 'install', '--database', path], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /extension installed/);
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /already installed/);
    assert.equal(positionIndexCapability(db).status, 'installed');
    assert.equal(db.pragma('user_version', { simple: true }), 7);
  }));
