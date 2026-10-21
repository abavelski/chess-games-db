import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { Chess } from 'chessops/chess';
import {
  positionFingerprint, toSqliteInt64, fromSqliteInt64, samePositionFingerprint,
} from '../lib/position-hash.mjs';

test('SQLite 64-bit signed mapping round-trips both signs without Number conversion', () => {
  // Isolated in-memory SQLite database, never a selected user archive.
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE samples (value INTEGER NOT NULL, pawn INTEGER NOT NULL, verification_key TEXT NOT NULL)');
    const start = positionFingerprint(Chess.default());
    const small = 0x0123456789abcdefn;
    const large = 0xfedcba9876543210n;
    const insert = db.prepare('INSERT INTO samples VALUES (?, ?, ?)');
    for (const hash of [small, large, start.hash]) {
      insert.run(toSqliteInt64(hash), toSqliteInt64(start.pawnHash), start.verificationKey);
    }
    const read = db.prepare('SELECT value, pawn, verification_key FROM samples ORDER BY rowid').safeIntegers();
    const rows = read.all();
    assert.equal(rows.length, 3);
    for (let i = 0; i < rows.length; i++) {
      const hash = [small, large, start.hash][i];
      assert.equal(typeof rows[i].value, 'bigint');
      assert.equal(typeof rows[i].pawn, 'bigint');
      assert.equal(rows[i].value, BigInt.asIntN(64, hash));
      assert.equal(fromSqliteInt64(rows[i].value), hash);
      assert.equal(fromSqliteInt64(rows[i].pawn), start.pawnHash);
    }
    assert.ok(rows[0].value >= 0n);
    assert.ok(rows[1].value < 0n);
    assert.throws(() => toSqliteInt64(-1n), /unsigned/);
    assert.throws(() => toSqliteInt64(1n << 64n), /unsigned/);
    assert.throws(() => fromSqliteInt64(1n << 63n), /signed/);
  } finally {
    db.close();
  }
});

test('indexed candidates must use independent position key to check forced collisions', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE indexed (hash INTEGER NOT NULL, verification_key TEXT NOT NULL)');
    const a = positionFingerprint(Chess.default());
    const b = { ...a, verificationKey: a.verificationKey.replace(' w ', ' b ') };
    const add = db.prepare('INSERT INTO indexed VALUES (?, ?)');
    for (const position of [a, b]) add.run(position.sqliteHash, position.verificationKey);
    const candidates = db.prepare('SELECT hash, verification_key FROM indexed WHERE hash = ?').safeIntegers().all(a.sqliteHash);
    assert.equal(candidates.length, 2);
    assert.equal(candidates.filter(row => samePositionFingerprint(
      { hash: fromSqliteInt64(row.hash), verificationKey: row.verification_key }, a,
    )).length, 1);
  } finally {
    db.close();
  }
});
