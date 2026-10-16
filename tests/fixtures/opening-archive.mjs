import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function frame(text) {
  const bytes = Buffer.from(text);
  if (bytes.length > 65535) throw new Error('Fixture too large');
  // Zstandard frame with one raw block and a four-byte content size.
  const header = Buffer.alloc(9); header.writeUInt32LE(0xfd2fb528); header[4] = 0xa0; header.writeUInt32LE(bytes.length, 5);
  const block = Buffer.alloc(3); block.writeUIntLE((bytes.length << 3) | 1, 0, 3);
  return Buffer.concat([header, block, bytes]);
}
export function hash(text) { return createHash('sha256').update(text).digest('hex'); }
export function fixtureArchive(path, games = ['1.e4 e5 2.Nf3 Nc6 *', '1. Nf3 Nf6 2.d4 d5 *', '1.h3 *', '1.e4 e5 2.Bh6 *']) {
  const db = new Database(path);
  for (const name of ['001_initial', '002_source_records', '003_record_classification', '004_openings']) db.exec(readFileSync(new URL(`../../db/migrations/${name}.sql`, import.meta.url), 'utf8'));
  db.pragma('user_version=4'); db.pragma('foreign_keys=ON');
  db.prepare("INSERT INTO sources(source_key,title) VALUES ('fixture','Fixture book')").run();
  for (let index = 0; index < games.length; index++) db.prepare('INSERT INTO games(source_id,source_game_key,white,black,eco,pgn_zstd,pgn_sha256) VALUES (1,?,?,?,?,?,?)').run(String(index), 'White ' + index, 'Black', 'A00', frame(games[index]), hash(games[index]));
  return db;
}
export const catalogueFiles = {
  a: 'eco\tname\tpgn\nA00\tStart\t1. a3\n', b: 'eco\tname\tpgn\nB00\tKing Pawn\t1. e4\n',
  c: 'eco\tname\tpgn\nC20\tOpen Game\t1. e4 e5\nC40\tOpen Game: Knight Line\t1. e4 e5 2. Nf3\nC44\tOpen Game: Knight Line, Two Knights\t1. e4 e5 2. Nf3 Nc6\n',
  d: 'eco\tname\tpgn\nD00\tQueen Pawn: Main Line, Setup\t1. d4 d5 2. Nf3 Nf6\n', e: 'eco\tname\tpgn\nE00\tAnother Family: Main Line\t1. d4 Nf6\n',
};
