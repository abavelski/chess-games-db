import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertGames } from '../lib/game-writer.mjs';
import { positionIndexCapability } from '../lib/position-index-storage.mjs';

const extensionSql = readFileSync(new URL('../db/migrations/009_position_index.sql', import.meta.url), 'utf8');

export function installPositionIndex(db) {
  assertGames(db);
  return db.transaction(() => {
    const before = positionIndexCapability(db);
    if (before.status === 'incompatible') {
      throw new Error('Incompatible or partial position-index extension; refusing to alter it');
    }
    db.exec(extensionSql);
    const after = positionIndexCapability(db);
    if (after.status !== 'installed') throw new Error('Position-index extension verification failed');
    if (db.pragma('foreign_key_check').length) throw new Error('Archive foreign-key integrity check failed');
    return { ...after, newlyInstalled: before.status === 'unavailable' };
  }).immediate();
}

export function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, strict: true,
    options: { database: { type: 'string' } },
  });
  if (positionals.length !== 1 || positionals[0] !== 'install' || !values.database) {
    throw new Error('Usage: npm run position-index -- install --database PATH');
  }
  const db = new Database(resolve(values.database), { fileMustExist: true });
  try {
    const result = installPositionIndex(db);
    console.log(result.newlyInstalled
      ? 'Position index extension installed (schema 7 preserved)'
      : 'Position index extension already installed (no changes)');
    return result;
  } finally {
    db.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error('Position index installation failed: ' + error.message);
    process.exitCode = 1;
  }
}
