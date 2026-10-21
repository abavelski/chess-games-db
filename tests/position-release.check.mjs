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
import { buildPositions, positionBuildStatus } from '../lib/position-builder.mjs';
import { positionFingerprint } from '../lib/position-hash.mjs';
import { resolveReviewNavigation, reviewedSearchFen } from '../src/review-navigation.mjs';
import { replayPosition } from '../src/analysis.mjs';
import { installPositionIndex } from '../scripts/position-index.mjs';
import { benchmarkPositionVariations } from '../scripts/benchmark-position-variations.mjs';
import { fixtureArchive, frame, hash, catalogueFiles } from './fixtures/opening-archive.mjs';

const checksum = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function fenAfter(...sans) {
  const chess = Chess.default();
  for (const san of sans) {
    const move = parseSan(chess, san);
    assert.ok(move, 'Expected legal SAN ' + san);
    chess.play(move);
  }
  return makeFen(chess.toSetup());
}
const snapshot = db => ({
  schema: db.pragma('user_version', { simple: true }),
  originalGames: db.prepare('SELECT id,game_key,pgn_sha256,pgn_zstd,headers_json,extras_json FROM games ORDER BY id').all(),
  sources: db.prepare('SELECT * FROM sources ORDER BY id').all(),
  personal: db.prepare('SELECT * FROM game_personal_analysis ORDER BY game_id').all(),
  features: db.prepare('SELECT * FROM game_features ORDER BY game_id').all(),
  openingState: db.prepare('SELECT * FROM opening_state').all(),
  gameOpenings: db.prepare('SELECT * FROM game_openings ORDER BY game_id').all(),
  openingMatches: db.prepare('SELECT * FROM game_opening_matches ORDER BY game_id').all(),
  favourites: db.pragma('table_info(games)').some(column => column.name === 'favourite') ?
    db.prepare('SELECT id,favourite FROM games ORDER BY id').all() : [],
});

test('PS-12 disposable schema-7 release: all-lines scope, interruption, concurrent reader, preservation, stale rebuild and exact paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps12-release-'));
  const source = join(dir, 'immutable-source.sqlite3');
  const copy = join(dir, 'working-copy.sqlite3');
  const pgns = [
    '1. Nf3 (1. d4 d5 (1... Nf6)) Nf6 2. g3 g6 *',
    '1. d4 d5 2. c4 *',
    '1. e4 {[%crit important] Source note} e5 (1... c5 2. Nf3) 2. Nf3 Nc6 *',
    '1. e4 e5 (1... Ke9) 2. Nf3 Nc6 *',
    '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 *',
    '1. Nf3 (1. d4 d5) Nf6 *',
    '[SetUp "1"]\n[FEN "4k3/P7/8/8/8/8/8/4K3 w - - 0 15"]\n\n15. a8=Q+ (15. a8=N) *',
  ];
  let sourceReader, reader, db;
  try {
    const fixture = fixtureArchive(source, pgns);
    for (const id of [1, 2]) upsertGame(fixture, { id, year: id === 1 ? 2020 : 2000 });
    fixture.close();
    await enrichOpenings(source, { catalogue: buildCatalogue(catalogueFiles),
      manifest: { commit: 'b'.repeat(40) }, checksum: 'ps12-offline-openings' });
    sourceReader = new ChessArchive(source);
    sourceReader.savePersonal(1, {
      lines: [['e2e4']], comments: [{ moves: [], text: 'Private comment, not part of source PGN' }],
    });
    sourceReader.setFavourite(1, true);
    const sourceBytes = checksum(source);
    const readonly = new Database(source, { readonly: true, fileMustExist: true });
    const original = snapshot(readonly);
    await readonly.backup(copy);
    readonly.close();
    assert.equal(sourceReader.positionIndexCapability().status, 'unavailable');
    assert.equal(sourceReader.searchByPosition(fenAfter('d4'), { scope: 'includeSourceVariations' }).coverage.status, 'unavailable');

    db = new Database(copy, { fileMustExist: true });
    reader = new ChessArchive(copy); // Open before installation/build: no restart required.
    assert.equal(reader.catalog().capabilities.positionIndex.status, 'unavailable');
    installPositionIndex(db);
    assert.equal(reader.searchByPosition(fenAfter('d4')).coverage.status, 'partial');
    const mainStart = await buildPositions(db, { maxGames: 2, batchSize: 1 });
    assert.equal(mainStart.attempted, 2);
    assert.equal(reader.searchByPosition(fenAfter('d4')).coverage.unindexed, pgns.length - 2);
    assert.equal(reader.searchByPosition(fenAfter('d4')).total, 1, 'only the indexed played d4 game may match');
    const completedMain = await buildPositions(db, { batchSize: 2 });
    assert.equal(completedMain.skipped, 2);
    assert.equal(reader.searchByPosition(fenAfter('d4')).coverage.isComplete, true);
    assert.equal(reader.searchByPosition(fenAfter('d4')).total, 1);

    const observed = []; let interrupted = false;
    const halfway = await buildPositions(db, {
      includeVariations: true, batchSize: 1, shouldStop: () => interrupted,
      onProgress: () => {
        const main = reader.searchByPosition(fenAfter('d4'));
        const all = reader.searchByPosition(fenAfter('d4'), { scope: 'includeSourceVariations' });
        assert.equal(main.coverage.isComplete, true, 'never lose verified mainline coverage');
        assert.ok(all.total >= main.total, 'readers see only complete per-game publications');
        observed.push({ played: main.total, varied: all.total });
        if (observed.length === 1) interrupted = true;
      },
    });
    assert.equal(halfway.stopped, true);
    assert.equal(observed.length, 1);
    assert.equal(positionBuildStatus(db).allComplete, 1);
    const resumed = await buildPositions(db, { includeVariations: true, batchSize: 2 });
    assert.equal(resumed.variationIncomplete, 1, 'malformed author branch retains only sound mainline');
    assert.equal(positionBuildStatus(db).allComplete, pgns.length - 1);
    assert.equal(reader.searchByPosition(fenAfter('d4')).coverage.isComplete, true);
    const scope = { scope: 'includeSourceVariations' };
    const d4 = fenAfter('d4');
    const all = reader.searchByPosition(d4, scope);
    assert.equal(all.coverage.isComplete, false);
    assert.equal(all.coverage.mainlineOnly, 1);
    assert.equal(all.total, 3, 'same position belongs to independent annotated editions');
    assert.deepEqual(all.rows.map(row => row.id), [1, 2, 6]);
    assert.deepEqual(all.rows.map(row => row.match.type), ['sourceVariation', 'playedGame', 'sourceVariation']);
    assert.equal(reader.searchByPosition(d4).total, 1);
    for (const hit of all.rows) {
      const navigation = resolveReviewNavigation(reader.getGame(hit.id).pgn, hit.match, d4);
      assert.equal(navigation.path, hit.match.path, 'source sideline must resolve to the indexed exact path');
      assert.equal(navigation.notice, null);
    }
    const nested = reader.searchByPosition(fenAfter('d4', 'Nf6'), scope);
    assert.equal(nested.total, 1, 'nested author variation is indexed');
    const key = positionFingerprint(d4);
    const indexedPawn = db.prepare('SELECT k.zobrist_hash,k.exact_key,k.pawn_hash,k.pawn_signature' +
      ' FROM game_position_occurrences o JOIN position_keys k ON k.id=o.position_id' +
      ' WHERE o.game_id=1 AND o.is_mainline=0 AND k.exact_key=?').safeIntegers().get(key.verificationKey);
    assert.equal(indexedPawn.zobrist_hash, key.sqliteHash);
    assert.equal(indexedPawn.pawn_hash, key.sqlitePawnHash);
    assert.equal(indexedPawn.pawn_signature, key.pawnSignature);
    // Fabricate a collision on the integer hash; candidate verification must
    // require the complete 4-field exact key, not just the bigint hash.
    const fakeKey = positionFingerprint(fenAfter('e4'));
    const inserted = db.prepare('INSERT INTO position_keys(zobrist_hash,exact_key,pawn_hash,pawn_signature) VALUES(?,?,?,?)')
      .run(key.sqliteHash, fakeKey.verificationKey, fakeKey.sqlitePawnHash, fakeKey.pawnSignature);
    db.prepare('INSERT INTO game_position_occurrences(game_id,position_id,path,ply,is_mainline) VALUES(?,?,?,?,?)')
      .run(2, inserted.lastInsertRowid, 'zz', 90, 0);
    assert.deepEqual(reader.searchByPosition(d4, scope).rows.map(row => row.id), [1, 2, 6]);
    assert.equal(reader.searchByPosition(fenAfter('e4'), scope).total, 2,
      'fake same-hash collision cannot leak an occurrence into the true e4 lookup');
    db.prepare("DELETE FROM game_position_occurrences WHERE path='zz'").run();
    db.prepare('DELETE FROM position_keys WHERE id=?').run(inserted.lastInsertRowid);

    assert.equal(reader.searchByPosition(d4, { ...scope, yearFrom: '2010' }).total, 2);
    assert.deepEqual(reader.searchByPosition(d4, { ...scope, favouritesOnly: true }).rows.map(row => row.id), [1]);
    assert.equal(reader.getGame(1).personal.comments[0].text, 'Private comment, not part of source PGN');
    assert.equal(reader.getGame(1).favourite, 1);
    assert.ok(reader.getGame(3).pgn.includes('[%crit important]'));
    assert.ok(reader.openingFacets({}).nodes.length > 0, 'offline named-opening catalogue remains intact');
    const userBranchFen = reviewedSearchFen(replayPosition(makeFen(Chess.default().toSetup()), ['e2e4']));
    assert.equal(userBranchFen, positionFingerprint(fenAfter('e4')).verificationKey);
    assert.equal(reader.searchByPosition(userBranchFen, scope).total, 2,
      'personal review is a query source, never a new indexed game occurrence');
    assert.equal(reader.searchByPosition(fenAfter('a4'), scope).coverage.isComplete, false);
    const beforeRebuild = db.prepare('SELECT game_id,path,ply,is_mainline,position_id FROM game_position_occurrences ORDER BY game_id,path').all();
    db.exec("CREATE TRIGGER release_write_abort BEFORE INSERT ON game_position_occurrences " +
      "BEGIN SELECT RAISE(ABORT, 'injected release test failure'); END");
    await assert.rejects(buildPositions(db, { includeVariations: true, rebuild: true, maxGames: 1 }), /injected release test failure/);
    assert.deepEqual(db.prepare('SELECT game_id,path,ply,is_mainline,position_id FROM game_position_occurrences ORDER BY game_id,path').all(), beforeRebuild,
      'failed individual-game rebuild rolls back to last published state');
    db.exec('DROP TRIGGER release_write_abort');
    const rebuilt = await buildPositions(db, { includeVariations: true, rebuild: true });
    assert.equal(rebuilt.variationIncomplete, 1);
    assert.equal(reader.searchByPosition(d4, scope).total, 3);
    const after = snapshot(db);
    assert.deepEqual(after, original, 'original PGN/source/notes/features/openings/favourites unchanged in indexed copy');
    assert.equal(db.pragma('user_version', { simple: true }), 7);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(checksum(source), sourceBytes, 'original archive was never modified');
    assert.equal(sourceReader.positionIndexCapability().status, 'unavailable');

    upsertGame(db, { id: 2, pgn_zstd: frame('1. c4 e5 *'), pgn_sha256: hash('1. c4 e5 *') }, { derive: false });
    assert.equal(reader.searchByPosition(d4, scope).total, 2, 'reimport invalidates old variation and mainline data');
    assert.equal(reader.searchByPosition(d4, scope).coverage.stale, 1);
    await buildPositions(db, { includeVariations: true });
    assert.equal(reader.searchByPosition(d4, scope).total, 2);
    assert.equal(reader.searchByPosition(fenAfter('c4')).total, 1);
    assert.equal(checksum(source), sourceBytes, 'source unchanged after working-copy reimport');
  } finally {
    reader?.close(); sourceReader?.close(); db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PS-12 comparative benchmark fixture is all-scope complete and never changes input source', async () => {
  const measurements = await benchmarkPositionVariations({ games: 12, samples: 5, warmups: 1 });
  assert.equal(measurements.sourceUnchanged, true);
  assert.equal(measurements.mainline.complete, 12);
  assert.equal(measurements.allVariations.allComplete, 12);
  assert.equal(measurements.allVariations.partialVariations, 0);
  assert.ok(measurements.growth.occurrenceIncrease > 0);
  assert.ok(measurements.growth.bytes >= 0);
  assert.ok(measurements.positions.authorOnly.includeSourceVariations.matches >
    measurements.positions.authorOnly.mainlineOnAllCopy.matches);
  for (const position of Object.values(measurements.positions)) {
    for (const sample of Object.values(position)) {
      assert.ok(Number.isFinite(sample.p50Ms) && Number.isFinite(sample.p95Ms));
      assert.ok(sample.p95Ms >= sample.p50Ms);
    }
  }
});
