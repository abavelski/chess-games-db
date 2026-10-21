import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { initializeGames, upsertGame } from '../lib/game-writer.mjs';
import { positionFingerprint } from '../lib/position-hash.mjs';
import { buildPositions, POSITION_INDEXER_VERSION } from '../lib/position-builder.mjs';
import { installPositionIndex } from '../scripts/position-index.mjs';
import { ChessArchive } from '../electron/database.mjs';
import { POSITION_HITS_CTE, POSITION_HIT_PARAMS } from '../electron/position-search.mjs';
import { fixtureArchive, catalogueFiles, frame, hash } from './fixtures/opening-archive.mjs';
import { buildCatalogue } from '../electron/openings.mjs';
import { enrichOpenings } from '../electron/opening-enrichment.mjs';

const start = makeFen(Chess.default().toSetup());
function fenAfter(...sans) {
  const position = Chess.default();
  for (const san of sans) {
    const move = parseSan(position, san);
    assert.ok(move, 'legal SAN: ' + san);
    position.play(move);
  }
  return makeFen(position.toSetup());
}
const input = (pgn, extra = {}) => ({
  white: 'White', black: 'Black', pgn_zstd: frame(pgn),
  pgn_sha256: hash(pgn), ...extra,
});
async function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'position-search-'));
  const path = join(directory, 'games.sqlite3');
  let db, archive;
  try {
    db = new Database(path);
    initializeGames(db);
    archive = new ChessArchive(path);
    await run({ db, archive, path });
  } finally {
    archive?.close();
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test('PS-05 transpositions, distinct editions, repeated paths, pagination and exact FEN', () =>
  fixture(async ({ db, archive }) => {
    const first = upsertGame(db, input('1. Nf3 Nf6 2. g3 g6 *', { white: 'First edition' }));
    const second = upsertGame(db, input('1. g3 g6 2. Nf3 Nf6 *', { white: 'Second edition' }));
    const repeated = upsertGame(db, input('1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 *'));
    upsertGame(db, input('1. g3 g6 2. Nf3 Nf6 *', { hidden: 1, white: 'Hidden' }));
    installPositionIndex(db);
    await buildPositions(db, { batchSize: 2 });
    const fen = fenAfter('Nf3', 'Nf6', 'g3', 'g6');
    const result = archive.searchByPosition(fen);
    assert.equal(result.coverage.status, 'complete');
    assert.equal(result.coverage.total, 3, 'hidden game does not affect visible coverage');
    assert.equal(result.total, 2);
    assert.deepEqual(result.rows.map(row => row.id), [first, second]);
    assert.equal(result.rows[0].match.ply, 4);
    assert.equal(result.rows[1].match.ply, 4);
    assert.notEqual(result.rows[0].match.path, result.rows[1].match.path,
      'transposed scores keep their own reviewer path');
    assert.equal(result.rows[0].match.isMainline, true);
    assert.equal(result.rows[0].game_key.length > 0, true);
    const reverse = archive.searchByPosition(fen, { sort: 'newest', pageSize: 1, page: 1 });
    assert.deepEqual(reverse.rows.map(row => row.id), [second]);
    assert.equal(reverse.total, 2);
    assert.deepEqual(archive.searchByPosition(fen, { sort: 'newest', pageSize: 1, page: 2 }).rows
      .map(row => row.id), [first]);
    assert.deepEqual(archive.searchByPosition(fen, { pageSize: 1, page: 3 }).rows, []);
    assert.equal(archive.searchByPosition(fen, { pageSize: 1, page: 3 }).total, 2);

    const rootHits = archive.searchByPosition(start);
    assert.equal(rootHits.total, 3, 'two editions and repeated game, not each occurrence');
    assert.ok(rootHits.rows.every(row => row.match.path === '' && row.match.ply === 0));
    const knightHits = archive.searchByPosition(fenAfter('Nf3', 'Nf6'));
    assert.equal(knightHits.total, 2);
    assert.equal(knightHits.rows.find(row => row.id === repeated).match.ply, 2,
      'same game revisiting a position chooses earliest ply');
    assert.equal(archive.searchByPosition(start.replace(' w ', ' b ')).total, 0);
    assert.equal(archive.searchByPosition(start.replace(' KQkq ', ' - ')).total, 0);
    const zero = archive.searchByPosition(fenAfter('e4'));
    assert.equal(zero.total, 0);
    assert.equal(zero.coverage.isComplete, true, 'zero hits are authoritative only for complete coverage');
    assert.equal(db.pragma('user_version', { simple: true }), 7);
  }));

test('PS-05 applies existing opening hierarchy and filters without duplicate totals', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'position-filter-'));
  const path = join(directory, 'games.sqlite3');
  let db, archive;
  try {
    db = fixtureArchive(path, [
      '1.e4 e5 2.Nf3 Nc6 *',
      '1.e4 e5 2.Nf3 *',
      '1.Nf3 Nf6 2.d4 d5 *',
      '1.h3 *',
    ]);
    upsertGame(db, { id: 1, year: 2000 });
    upsertGame(db, { id: 2, year: 2020 });
    installPositionIndex(db);
    await buildPositions(db);
    await enrichOpenings(path, {
      catalogue: buildCatalogue(catalogueFiles),
      manifest: { commit: 'a'.repeat(40) }, checksum: 'search-fixture',
    });
    archive = new ChessArchive(path);
    const fen = fenAfter('e4', 'e5', 'Nf3');
    const facets = archive.openingFacets();
    const family = facets.nodes.find(node => node.label === 'Open Game');
    const line = facets.nodes.find(node => node.label === 'Knight Line');
    const subline = facets.nodes.find(node => node.label === 'Two Knights');
    assert.ok(family && line && subline);
    assert.equal(archive.searchByPosition(fen).total, 2);
    assert.equal(archive.searchByPosition(fen, { openingNodeId: family.id }).total, 2);
    assert.equal(archive.searchByPosition(fen, { openingNodeId: line.id }).total, 2);
    assert.deepEqual(archive.searchByPosition(fen, { openingNodeId: subline.id }).rows
      .map(row => row.id), [1]);
    assert.equal(archive.searchByPosition(fen, { openingNodeId: 'unclassified' }).total, 0);
    assert.equal(archive.searchByPosition(fen, { yearFrom: '2010' }).total, 1);
    assert.equal(archive.searchByPosition(fen, { yearTo: '2010' }).total, 1);
    assert.equal(archive.searchByPosition(fen, { search: 'White 0' }).total, 1);
    assert.equal(archive.searchByPosition(fen, { properties: { year: ['2000'] } }).total, 1);
    assert.equal(archive.searchByPosition(fen, { properties: { white: ['1'] } }).total, 1);
    assert.equal(archive.searchByPosition(fen, {
      properties: { source: ['1'], sourceType: ['other'], eco: ['A00'] },
    }).total, 2);
    assert.equal(archive.searchByPosition(fen, {
      properties: { source: ['1'], year: ['2000'], result: ['unknown'] },
      openingNodeId: family.id, search: 'White 0', yearFrom: '1990',
    }).total, 1);
    assert.equal(archive.searchByPosition(fen, { personalOnly: true }).total, 0);
    assert.equal(archive.searchByPosition(fen, { favouritesOnly: true }).total, 0);
    archive.setFavourite(1, true);
    archive.savePersonal(1, {
      lines: [], comments: [{ moves: [], text: 'Private game note' }],
    });
    assert.deepEqual(archive.searchByPosition(fen, {
      favouritesOnly: true, personalOnly: true, openingNodeId: subline.id,
      properties: { source: ['1'] },
    }).rows.map(row => row.id), [1]);
    assert.equal(archive.searchByPosition(fen, {
      favouritesOnly: true, personalOnly: true, yearFrom: '2010',
    }).total, 0);
    assert.equal(archive.searchByPosition(fen, { sort: 'newest', pageSize: 1 }).rows[0].id, 2);
    assert.equal(archive.searchByPosition(fen, { sort: 'newest', pageSize: 1, page: 2 }).rows[0].id, 1);
    assert.equal(archive.searchByPosition(fen, { pageSize: 1, page: 3 }).total, 2);
    assert.deepEqual(archive.searchByPosition(fen, { pageSize: 1, page: 3 }).rows, []);
    assert.equal(archive.searchGames({ openingNodeId: family.id }).total, 2,
      'old search path is unchanged');
  } finally {
    archive?.close();
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('PS-05 coverage reports absent, unindexed, building, partial, invalid, stale and unsupported', () =>
  fixture(async ({ db, archive, path }) => {
    const id1 = upsertGame(db, input('1.e4 *'));
    const id2 = upsertGame(db, input('1.d4 *'));
    const id3 = upsertGame(db, input('1.Nf3 *'));
    const before = readFileSync(path);
    const unavailable = archive.searchByPosition(start);
    assert.equal(unavailable.total, 0);
    assert.equal(unavailable.coverage.status, 'unavailable');
    assert.equal(unavailable.coverage.unindexed, 3);
    assert.equal(unavailable.coverage.isComplete, false);
    assert.deepEqual(readFileSync(path), before, 'queries do not install an extension');

    installPositionIndex(db);
    assert.equal(archive.searchByPosition(start).coverage.unindexed, 3);
    await buildPositions(db, { maxGames: 1 });
    const partiallyIndexed = archive.searchByPosition(start);
    assert.equal(partiallyIndexed.total, 1);
    assert.equal(partiallyIndexed.coverage.status, 'partial');
    assert.equal(partiallyIndexed.coverage.complete, 1);
    assert.equal(partiallyIndexed.coverage.unindexed, 2);
    const state = db.prepare(
      "INSERT INTO game_position_index_state(game_id,pgn_sha256,algorithm_id,indexer_version,scope,status)" +
      " VALUES(?,?,?,?,?,'building')");
    state.run(id2, hash('1.d4 *'), 'polyglot-standard-v1', POSITION_INDEXER_VERSION, 'mainline');
    assert.equal(archive.searchByPosition(start).coverage.building, 1);
    db.prepare("UPDATE game_position_index_state SET status='partial' WHERE game_id=?").run(id2);
    assert.equal(archive.searchByPosition(start).coverage.partial, 1);

    await buildPositions(db);
    const complete = archive.searchByPosition(start);
    assert.equal(complete.total, 3);
    assert.equal(complete.coverage.status, 'complete');
    db.prepare("UPDATE game_position_index_state SET status='failed',completed_at=NULL,diagnostic='invalid PGN' WHERE game_id=?").run(id2);
    const invalid = archive.searchByPosition(start);
    assert.equal(invalid.total, 2);
    assert.equal(invalid.coverage.invalid, 1);
    assert.equal(invalid.coverage.isComplete, false);
    db.prepare("UPDATE game_position_index_state SET indexer_version='unsupported' WHERE game_id=?").run(id2);
    assert.equal(archive.searchByPosition(start).coverage.unsupported, 1);
    assert.equal(archive.searchByPosition(start).total, 2);
    await buildPositions(db);
    assert.equal(archive.searchByPosition(start).total, 3);
    upsertGame(db, { id: id3, pgn_zstd: frame('1.c4 *'), pgn_sha256: hash('1.c4 *') }, { derive: false });
    assert.equal(archive.searchByPosition(start).coverage.stale, 1);
    assert.equal(archive.searchByPosition(start).total, 2);
    assert.equal(archive.searchByPosition(start).coverage.isComplete, false);
    assert.ok(id1 > 0);
  }));

test('PS-05 preserves exact en-passant semantics, including pinned adjacent pawns', () =>
  fixture(async ({ db, archive }) => {
    const legal = upsertGame(db, input('1. e4 a6 2. e5 d5 3. exd6 *'));
    const pinnedFen = 'k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
    const pinned = upsertGame(db, input(
      '[SetUp "1"]\n[FEN "' + pinnedFen + '"]\n\n*',
      { white: 'Pinned en passant' },
    ));
    installPositionIndex(db);
    await buildPositions(db);
    const legalFen = fenAfter('e4', 'a6', 'e5', 'd5');
    assert.match(legalFen, / d6 /);
    assert.deepEqual(archive.searchByPosition(legalFen).rows.map(r => r.id), [legal]);
    assert.equal(archive.searchByPosition(legalFen.replace(' d6 ', ' - ')).total, 0);
    assert.deepEqual(archive.searchByPosition(pinnedFen).rows.map(r => r.id), [pinned]);
    assert.equal(archive.searchByPosition(pinnedFen.replace(' d6 ', ' - ')).total, 0,
      'Polyglot EP hashes pinned adjacent pawns even when the reviewer omits legal EP');
  }));

test('PS-05 strict FEN/filter validation, collision verification, indexed plan and no PGN decode', () =>
  fixture(async ({ db, archive }) => {
    const good = upsertGame(db, input('1.e4 *'));
    const forgedGame = upsertGame(db, input('*', { white: 'Forced collision' }));
    installPositionIndex(db);
    await buildPositions(db);
    const fp = positionFingerprint(start);
    const forged = fp.verificationKey.replace(' w ', ' b ');
    const keyId = db.prepare('INSERT INTO position_keys(zobrist_hash,exact_key,pawn_hash,pawn_signature) VALUES(?,?,?,?)')
      .run(fp.sqliteHash, forged, fp.sqlitePawnHash, fp.pawnSignature).lastInsertRowid;
    db.prepare("UPDATE game_position_occurrences SET position_id=? WHERE game_id=? AND path=''")
      .run(keyId, forgedGame);
    const root = archive.searchByPosition(start);
    assert.deepEqual(root.rows.map(row => row.id), [good],
      'equal 64-bit hashes with distinct verification keys must not match');
    assert.equal(root.coverage.isComplete, true);
    assert.equal(db.prepare('SELECT count(*) n FROM position_keys WHERE zobrist_hash=?')
      .get(fp.sqliteHash).n, 2, 'both exact keys share the forced collision');
    assert.equal(archive.searchByPosition(start.replace(' w ', ' b ')).total, 0,
      'a client FEN computes its own turn-dependent hash; no hash is trusted from storage');

    const lookup = db.prepare('EXPLAIN QUERY PLAN SELECT id FROM position_keys WHERE zobrist_hash=? AND exact_key=?')
      .all(fp.sqliteHash, fp.verificationKey).map(r => r.detail).join(' ');
    assert.match(lookup, /USING COVERING INDEX/);
    const occurrencePlan = db.prepare('EXPLAIN QUERY PLAN ' + POSITION_HITS_CTE +
      ' SELECT count(*) FROM position_hits hit WHERE hit.hit_rank=1')
      .all({ positionId: 1, ...POSITION_HIT_PARAMS }).map(r => r.detail).join(' ');
    assert.match(occurrencePlan, /game_position_occurrences_position/);
    // Index reads never inflate PGN data, even if source compression is damaged.
    db.prepare("UPDATE games SET pgn_zstd=x'00' WHERE id=?").run(good);
    assert.equal(archive.searchByPosition(start).total, 1);
    assert.throws(() => archive.getGame(good));

    for (const fen of [
      'invalid', '8/8/8/8/8/8/8/8 w - - 0 1', start + '; DROP TABLE games;',
      'x'.repeat(257), null, { zobristHash: '123' },
    ]) assert.throws(() => archive.searchByPosition(fen), /FEN|chess|position|Invalid|Expected|standard/i);
    for (const filters of [
      { pageSize: 101 }, { page: -1 }, { page: 0 }, { sort: 'g.id; DROP TABLE games' },
      { properties: { unknown: ['x'] } }, { properties: { white: ["1' OR 1=1"] } },
      { openingNodeId: "' OR 1=1 --" }, { favouritesOnly: 'yes' },
      { search: 'x'.repeat(201) }, { sql: 'DROP TABLE games' }, null,
    ]) assert.throws(() => archive.searchByPosition(start, filters));
    assert.equal(db.prepare('SELECT count(*) n FROM games').get().n, 2);
    assert.equal(db.pragma('user_version', { simple: true }), 7);
  }));
