import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { cpus, totalmem, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { ChessArchive } from '../electron/database.mjs';
import { POSITION_HITS_CTE, POSITION_HIT_PARAMS } from '../electron/position-search.mjs';
import { positionBuildStatus, buildPositions } from '../lib/position-builder.mjs';
import { positionFingerprint } from '../lib/position-hash.mjs';
import { installPositionIndex } from './position-index.mjs';
import { fixtureArchive } from '../tests/fixtures/opening-archive.mjs';

const lineA = '1. Nf3 Nf6 2. g3 g6 3. Bg2 Bg7 4. O-O O-O 5. d3 d6 6. e4 e5 7. Nc3 Nc6 8. Be3 Be6 9. Qd2 Qd7 10. Rad1 Rad8 *';
const lineB = '1. g3 g6 2. Bg2 Bg7 3. Nf3 Nf6 4. O-O O-O 5. d3 d6 6. e4 e5 7. Nc3 Nc6 8. Be3 Be6 9. Qd2 Qd7 10. Rad1 Rad8 *';
const common = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 *';
const rare = '1. a4 h5 2. Ra3 Rh6 *';
const custom = '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K3 w - - 0 1"]\n\n*';
const invalid = '1. e4 e5 2. Ke9 *';
const variation = '1. e4 {Annotated [%crit opening]} e5 (1... c5 2. Nf3) 2. Nf3 Nc6 *';
const repeat = '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 *';

export function benchmarkFixtureScores(count) {
  if (!Number.isSafeInteger(count) || count < 12 || count > 50000) throw new Error('Fixture game count must be 12–50000');
  const choices = [common, common, common, lineA, lineB, repeat, rare, variation, '1. d4 d5 2. c4 e6 *', '1. c4 e5 2. Nc3 Nf6 *'];
  return [...Array.from({ length: count - 2 }, (_, i) => choices[i % choices.length]), custom, invalid];
}

function positionFromSans(sans) {
  const position = Chess.default();
  for (const san of sans) {
    const move = parseSan(position, san);
    if (!move) throw new Error('Bad benchmark SAN: ' + san);
    position.play(move);
  }
  return makeFen(position.toSetup());
}

export const BENCHMARK_POSITIONS = Object.freeze({
  start: makeFen(Chess.default().toSetup()),
  commonOpening: positionFromSans(['e4', 'e5', 'Nf3', 'Nc6']),
  transposedMiddlegame: positionFromSans(['Nf3','Nf6','g3','g6','Bg2','Bg7','O-O','O-O','d3','d6','e4','e5','Nc3','Nc6','Be3','Be6','Qd2','Qd7','Rad1','Rad8']),
  rarePosition: positionFromSans(['a4','h5','Ra3','Rh6']),
});

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const percentile = (sorted, portion) => sorted[Math.max(0, Math.ceil(sorted.length * portion) - 1)];
const rounded = n => Number(n.toFixed(3));
const elapsed = async callback => {
  const start = performance.now();
  const result = await callback();
  return { ms: rounded(performance.now() - start), result };
};

function searchMeasurement(archive, fen, samples, warmups) {
  for (let i = 0; i < warmups; i++) archive.searchByPosition(fen, { pageSize: 40 });
  const measurements = [];
  let last;
  for (let i = 0; i < samples; i++) {
    const before = performance.now();
    last = archive.searchByPosition(fen, { pageSize: 40 });
    measurements.push(performance.now() - before);
  }
  measurements.sort((a, b) => a - b);
  const { sqliteHash, verificationKey } = positionFingerprint(fen);
  const key = archive.db.prepare('SELECT id FROM position_keys WHERE zobrist_hash=? AND exact_key=?').get(sqliteHash, verificationKey);
  const frequency = key ? archive.db.prepare('SELECT count(*) occurrences,count(DISTINCT game_id) games FROM game_position_occurrences WHERE position_id=? AND is_mainline=1').get(key.id)
    : { occurrences: 0, games: 0 };
  assert.equal(last.total, frequency.games, 'fixture completeness ensures each raw game has one result');
  return {
    samples, warmups, p50Ms: rounded(percentile(measurements, .5)),
    p95Ms: rounded(percentile(measurements, .95)), matches: last.total,
    indexedOccurrences: frequency.occurrences, distinctGameIds: frequency.games,
    duplicateOccurrences: frequency.occurrences - frequency.games,
    coverage: last.coverage.status,
  };
}

/** Uses SQLite's online backup from a read-only source to a disposable copy.
 * Never installs an index or writes any data to the provided archive path.
 */
export async function benchmarkPositions({ database, games = 240, samples = 80, warmups = 10 } = {}) {
  if (![games, samples, warmups].every(Number.isSafeInteger) ||
      games < 12 || games > 50000 || samples < 5 || samples > 2000 ||
      warmups < 0 || warmups > 1000) throw new Error('Invalid benchmark sizes');
  const directory = mkdtempSync(join(tmpdir(), 'ps08-benchmark-'));
  const source = database ? resolve(database) : join(directory, 'fixture-original.sqlite3');
  const copy = join(directory, 'working-copy.sqlite3');
  let writer, archive;
  try {
    if (!database) fixtureArchive(source, benchmarkFixtureScores(games)).close();
    const sourceShaBefore = sha256(source);
    const original = new Database(source, { readonly: true, fileMustExist: true });
    try {
      assert.equal(original.pragma('user_version', { simple: true }), 7, 'schema-7 source required');
      await original.backup(copy);
    } finally { original.close(); }
    writer = new Database(copy, { fileMustExist: true });
    const before = positionBuildStatus(writer);
    const setup = await elapsed(() => installPositionIndex(writer));
    const first = await elapsed(() => buildPositions(writer, { batchSize: 25, rebuild: before.capability === 'installed' }));
    const incremental = await elapsed(() => buildPositions(writer, { batchSize: 25 }));
    const rebuild = await elapsed(() => buildPositions(writer, { batchSize: 25, rebuild: true }));
    const after = positionBuildStatus(writer);
    const planKey = writer.prepare('EXPLAIN QUERY PLAN SELECT id FROM position_keys WHERE zobrist_hash=? AND exact_key=?')
      .all(positionFingerprint(BENCHMARK_POSITIONS.start).sqliteHash, positionFingerprint(BENCHMARK_POSITIONS.start).verificationKey)
      .map(row => row.detail);
    const planOccurrences = writer.prepare('EXPLAIN QUERY PLAN ' + POSITION_HITS_CTE +
      ' SELECT game_id FROM position_hits WHERE hit_rank=1').all({ positionId: 1, ...POSITION_HIT_PARAMS }).map(row => row.detail);
    assert.ok(planKey.some(line => /INDEX/.test(line)));
    assert.ok(planOccurrences.some(line => /game_position_occurrences_position/.test(line)));
    // Failed PGNs are intentionally retried; only completed inputs are skipped.
    assert.equal(incremental.result.attempted, first.result.invalid,
      'incremental build should retry invalid sources without replaying completed games');
    assert.equal(incremental.result.skipped, first.result.complete);
    assert.equal(after.complete + after.invalid, after.total, 'fixture must have no missing/stale indexed games');
    assert.deepEqual(writer.pragma('foreign_key_check'), []);
    writer.close(); writer = null;
    archive = new ChessArchive(copy);
    const positions = Object.fromEntries(Object.entries(BENCHMARK_POSITIONS)
      .map(([name, fen]) => [name, searchMeasurement(archive, fen, samples, warmups)]));
    archive.close(); archive = null;
    const sourceShaAfter = sha256(source);
    assert.equal(sourceShaAfter, sourceShaBefore, 'original archive was modified');
    return {
      source: database ? 'provided database (read-only SQLite backup)' : 'generated deterministic fixture only',
      scope: 'mainline', fixtureGamesRequested: database ? null : games,
      sampleSizePerPosition: samples, warmups, originalUntouched: true,
      environment: { platform: process.platform, arch: process.arch,
        cpu: cpus()[0]?.model || 'unknown', logicalCpus: cpus().length,
        ramGiB: rounded(totalmem() / 1024 ** 3), node: process.versions.node, sqlite: writer?.constructor?.name || 'better-sqlite3' },
      before: { capability: before.capability, databaseBytes: before.databaseBytes, games: before.total },
      installMs: setup.ms, fullBuildMs: first.ms,
      firstBuild: { attempted: first.result.attempted, complete: first.result.complete, invalid: first.result.invalid },
      incrementalBuildMs: incremental.ms, incrementalSkipped: incremental.result.skipped,
      fullRebuildMs: rebuild.ms, rebuildAttempted: rebuild.result.attempted,
      after: { ...after, additionalDatabaseBytes: after.databaseBytes - before.databaseBytes,
        footprintIsFresh: before.capability !== 'installed' },
      queryPlan: { key: planKey, occurrences: planOccurrences },
      positions,
    };
  } finally {
    archive?.close(); writer?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({ strict: true, options: {
    database: { type: 'string' }, games: { type: 'string' },
    samples: { type: 'string' }, warmups: { type: 'string' },
  } });
  const numeric = name => values[name] === undefined ? undefined : Number(values[name]);
  const result = await benchmarkPositions({
    database: values.database, games: numeric('games'), samples: numeric('samples'),
    warmups: numeric('warmups'),
  });
  console.log('PS08_BENCHMARK_JSON ' + JSON.stringify(result));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error('Position benchmark failed:', error); process.exitCode = 1; });
}
