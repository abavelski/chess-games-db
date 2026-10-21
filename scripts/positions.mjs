import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertGames } from '../lib/game-writer.mjs';
import { positionIndexCapability } from '../lib/position-index-storage.mjs';
import { buildPositions, positionBuildStatus } from '../lib/position-builder.mjs';
import { installPositionIndex } from './position-index.mjs';

const usage = 'Usage: npm run positions -- (init|build|status|rebuild) --database PATH ' +
  '[--dry-run] [--batch-size N] [--max-games N] [--rebuild] [--include-variations]';

function positiveOption(value, name, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(name + ' must be a positive integer');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > max) {
    throw new Error(name + ' must be <= ' + max);
  }
  return number;
}

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, strict: true,
    options: {
      database: { type: 'string' },
      'dry-run': { type: 'boolean' },
      rebuild: { type: 'boolean' },
      'batch-size': { type: 'string' },
      'max-games': { type: 'string' },
      'include-variations': { type: 'boolean' },
    },
  });
  const mode = positionals[0];
  if (positionals.length !== 1 || !['init', 'build', 'status', 'rebuild'].includes(mode) ||
      !values.database?.trim()) throw new Error(usage);
  const batchSize = positiveOption(values['batch-size'], '--batch-size', 1000) ?? 25;
  const maxGames = positiveOption(values['max-games'], '--max-games') ?? Infinity;
  if (mode !== 'build' && mode !== 'rebuild' &&
      (values['batch-size'] !== undefined || values['max-games'] !== undefined ||
       values.rebuild || values['include-variations'])) {
    throw new Error('Batch/rebuild flags require build or rebuild mode');
  }
  const db = new Database(resolve(values.database), { fileMustExist: true });
  try {
    assertGames(db);
    if (mode === 'init') {
      if (values['dry-run']) {
        const before = positionIndexCapability(db);
        if (before.status === 'incompatible') throw new Error('Incompatible position-index extension');
        const result = { action: 'init', dryRun: true, current: before.status };
        console.log(JSON.stringify(result, null, 2));
        return result;
      }
      const result = installPositionIndex(db);
      console.log(JSON.stringify({ action: 'init', ...result }, null, 2));
      return result;
    }
    if (mode === 'status') {
      const result = positionBuildStatus(db);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    let stopped = false;
    const interrupt = () => { stopped = true; };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    try {
      const metrics = await buildPositions(db, {
        batchSize, maxGames, dryRun: !!values['dry-run'],
        rebuild: mode === 'rebuild' || !!values.rebuild,
        includeVariations: !!values['include-variations'],
        shouldStop: () => stopped,
        onProgress: progress => {
          if (progress.status !== 'complete' || progress.attempted % 25 === 0) {
            console.log(JSON.stringify({ progress }));
          }
        },
      });
      console.log(JSON.stringify({ action: mode, ...metrics }, null, 2));
      if (stopped) process.exitCode = 130;
      return metrics;
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error('Position builder failed: ' + error.message);
    process.exitCode = 1;
  }
}
