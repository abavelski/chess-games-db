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
import { buildPositions, positionBuildStatus } from '../lib/position-builder.mjs';
import { positionFingerprint } from '../lib/position-hash.mjs';
import { installPositionIndex } from './position-index.mjs';
import { fixtureArchive } from '../tests/fixtures/opening-archive.mjs';

// Repeated *legal, nested* source sidelines deliberately make the all-lines
// dataset larger than played mainlines. Saved personal lines are never indexed.
const VARIATION_SCORES = Object.freeze([
  '1. Nf3 (1. d4 d5 (1... Nf6)) Nf6 2. g3 g6 *',
  '1. d4 (1. Nf3 Nf6 2. Ng1 Ng8 3. d4) (1. Nh3 Nh6 2. Ng1 Ng8 3. d4) d5 *',
  '1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 *',
  '1. Nf3 (1. d4 d5 2. c4) Nf6 2. g3 g6 *',
  '1. d4 d5 2. c4 (2. Nf3 Nf6) e6 *',
  '1. c4 e5 (1... Nf6 2. Nc3) 2. Nc3 Nf6 *',
]);
export function variationBenchmarkScores(count) {
  if (!Number.isSafeInteger(count) || count < 6 || count > 50000) {
    throw new Error('Variation benchmark fixture count must be 6–50000');
  }
  return Array.from({ length: count }, (_, index) => VARIATION_SCORES[index % VARIATION_SCORES.length]);
}
function fenAfter(...sans) {
  const position = Chess.default();
  for (const san of sans) {
    const move = parseSan(position, san);
    assert.ok(move, 'Benchmark fixture SAN must be legal: ' + san);
    position.play(move);
  }
  return makeFen(position.toSetup());
}
const FENS = Object.freeze({
  start: makeFen(Chess.default().toSetup()),
  playedOpening: fenAfter('d4', 'd5'),
  authorOnly: fenAfter('d4', 'Nf6'),
  repeatedBranch: fenAfter('d4'),
  transposed: fenAfter('Nf3', 'Nf6'),
  absent: fenAfter('a4', 'h5'),
});
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const round = number => Number(number.toFixed(3));
const percentile = (values, ratio) => values[Math.ceil(values.length * ratio) - 1];
const byteSize = db => db.pragma('page_count', { simple: true }) * db.pragma('page_size', { simple: true });
async function timed(fn) {
  const before = performance.now();
  const value = await fn();
  return { ms: round(performance.now() - before), value };
}
function sampled(archive, fen, scope, samples, warmups) {
  const filter = { scope, pageSize: 40 };
  for (let n = 0; n < warmups; n++) archive.searchByPosition(fen, filter);
  const times = []; let result;
  for (let n = 0; n < samples; n++) {
    const before = performance.now();
    result = archive.searchByPosition(fen, filter);
    times.push(performance.now() - before);
  }
  times.sort((a, b) => a - b);
  return {
    p50Ms: round(percentile(times, .5)), p95Ms: round(percentile(times, .95)),
    matches: result.total, coverage: result.coverage.status, complete: result.coverage.isComplete,
    mainlineOnly: result.coverage.mainlineOnly,
    sourceVariationMatchesOnPage: result.rows.filter(row => row.match.type === 'sourceVariation').length,
  };
}
async function indexCopy(path, includeVariations) {
  const db = new Database(path, { fileMustExist: true });
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 7);
    installPositionIndex(db);
    const before = byteSize(db);
    const first = await timed(() => buildPositions(db, { includeVariations, rebuild: true, batchSize: 25 }));
    const initial = positionBuildStatus(db);
    const incremental = await timed(() => buildPositions(db, { includeVariations, batchSize: 25 }));
    const after = positionBuildStatus(db);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('user_version', { simple: true }), 7);
    return {
      installedBytes: before, databaseBytes: byteSize(db),
      buildMs: first.ms, incrementalMs: incremental.ms,
      attempted: first.value.attempted, invalid: first.value.invalid,
      partialVariations: first.value.variationIncomplete,
      incrementalAttempted: incremental.value.attempted, incrementalSkipped: incremental.value.skipped,
      coverage: after, occurrences: after.occurrences, distinctPositionKeys: after.positions,
      complete: initial.complete, allComplete: initial.allComplete,
    };
  } finally { db.close(); }
}
/** Read-only source snapshot -> two independent offline derived copies.
 * This function does not mutate the supplied archive, even when already indexed.
 */
export async function benchmarkPositionVariations({ database, games = 120, samples = 40, warmups = 8 } = {}) {
  if (![games, samples, warmups].every(Number.isSafeInteger) ||
    games < 6 || games > 50000 || samples < 5 || samples > 2000 ||
    warmups < 0 || warmups > 1000) throw new Error('Invalid variation benchmark sizes');
  const directory = mkdtempSync(join(tmpdir(), 'ps12-variation-bench-'));
  const source = database ? resolve(database) : join(directory, 'source.sqlite3');
  const baseline = join(directory, 'baseline.sqlite3');
  const allPath = join(directory, 'all-lines.sqlite3');
  let mainArchive, allArchive;
  try {
    if (!database) fixtureArchive(source, variationBenchmarkScores(games)).close();
    const sourceBefore = sha(source);
    const readonly = new Database(source, { readonly: true, fileMustExist: true });
    let originalBytes;
    try {
      assert.equal(readonly.pragma('user_version', { simple: true }), 7);
      originalBytes = byteSize(readonly);
      await readonly.backup(baseline);
      await readonly.backup(allPath);
    } finally { readonly.close(); }
    const main = await indexCopy(baseline, false);
    const all = await indexCopy(allPath, true);
    mainArchive = new ChessArchive(baseline);
    allArchive = new ChessArchive(allPath);
    const positions = {};
    for (const [name, fen] of Object.entries(FENS)) {
      positions[name] = {
        mainlineCopy: sampled(mainArchive, fen, 'mainline', samples, warmups),
        mainlineOnAllCopy: sampled(allArchive, fen, 'mainline', samples, warmups),
        includeSourceVariations: sampled(allArchive, fen, 'includeSourceVariations', samples, warmups),
      };
      assert.ok(positions[name].includeSourceVariations.matches >= positions[name].mainlineOnAllCopy.matches,
        'Opt-in cannot lose a verified played match');
    }
    const explain = (archive, includeVariations) => archive.db.prepare(
      'EXPLAIN QUERY PLAN ' + POSITION_HITS_CTE +
      ' SELECT game_id FROM position_hits WHERE hit_rank=1'
    ).all({ positionId: 1, ...POSITION_HIT_PARAMS, includeVariations }).map(row => row.detail);
    const plans = { mainline: explain(mainArchive, 0), variations: explain(allArchive, 1) };
    for (const plan of Object.values(plans)) {
      assert.ok(plan.some(line => /game_position_occurrences_position/.test(line)),
        'Scoped queries must use the position occurrence index');
    }
    const lookup = allArchive.db.prepare('EXPLAIN QUERY PLAN SELECT id FROM position_keys WHERE zobrist_hash=? AND exact_key=?')
      .all(positionFingerprint(FENS.repeatedBranch).sqliteHash,
        positionFingerprint(FENS.repeatedBranch).verificationKey).map(row => row.detail);
    assert.ok(lookup.some(line => /INDEX/.test(line)), 'Exact hash-key lookup must use SQLite index');
    if (!database) {
      assert.equal(main.complete, games);
      assert.equal(all.allComplete, games, 'fixture variation PGNs must all strictly replay');
      assert.equal(all.partialVariations, 0);
      assert.ok(all.occurrences > main.occurrences, 'fixture must contain variation-specific occurrences');
      assert.ok(positions.authorOnly.includeSourceVariations.matches >
        positions.authorOnly.mainlineOnAllCopy.matches, 'fixture must produce variation-only query matches');
      assert.ok(all.databaseBytes >= main.databaseBytes, 'additional variation rows must not shrink fixture database');
    }
    mainArchive.close(); mainArchive = null; allArchive.close(); allArchive = null;
    assert.equal(sha(source), sourceBefore, 'source archive must remain byte-for-byte unchanged');
    return {
      source: database ? 'provided archive (read-only online SQLite backups)' : 'generated variation-heavy schema-7 fixture only',
      fixtureGames: database ? null : games, samplesPerPositionPerScope: samples, warmups,
      environment: { platform: process.platform, arch: process.arch,
        cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length,
        ramGiB: round(totalmem() / 1024 ** 3), node: process.versions.node },
      sourceUnchanged: true, sourceBytes: originalBytes,
      mainline: main, allVariations: all,
      growth: {
        bytes: all.databaseBytes - main.databaseBytes,
        percentOfMainline: round((all.databaseBytes - main.databaseBytes) / main.databaseBytes * 100),
        occurrenceIncrease: all.occurrences - main.occurrences,
        occurrencePercent: main.occurrences ? round((all.occurrences - main.occurrences) / main.occurrences * 100) : null,
      },
      queryPlan: { positionKey: lookup, ...plans },
      positions,
    };
  } finally {
    mainArchive?.close(); allArchive?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
async function main() {
  const { values } = parseArgs({ strict: true, options: {
    database: { type: 'string' }, games: { type: 'string' },
    samples: { type: 'string' }, warmups: { type: 'string' },
  } });
  const value = name => values[name] === undefined ? undefined : Number(values[name]);
  const result = await benchmarkPositionVariations({
    database: values.database, games: value('games'), samples: value('samples'), warmups: value('warmups'),
  });
  console.log('PS12_VARIATION_BENCHMARK_JSON ' + JSON.stringify(result));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error('Variation benchmark failed:', error); process.exitCode = 1; });
}
