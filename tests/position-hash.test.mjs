import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { KEYS } from '../lib/polyglot-keys.mjs';
import {
  POSITION_HASH_ALGORITHM, PAWN_HASH_ALGORITHM, parseSearchPosition,
  positionFingerprint, samePositionFingerprint, samePawnFingerprint,
  hex64, toSqliteInt64, fromSqliteInt64,
} from '../lib/position-hash.mjs';

function replay(sans) {
  const position = Chess.default();
  for (const san of sans.split(' ').filter(Boolean)) {
    const move = parseSan(position, san);
    assert.ok(move, 'legal SAN: ' + san);
    position.play(move);
  }
  return position;
}

test('all nine independently published Polyglot full-position reference vectors', () => {
  // Toga II reference values from https://hgm.nubati.net/book_format.html
  const vectors = [
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', '463b96181691fc9c'],
    ['rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', '823c9b50fd114196'],
    ['rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2', '0756b94461c50fb0'],
    ['rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2', '662fafb965db29d4'],
    ['rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3', '22a48b5a8e47ff78'],
    ['rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPPKPPP/RNBQ1BNR b kq - 0 3', '652a607ca3f242c1'],
    ['rnbq1bnr/ppp1pkpp/8/3pPp2/8/8/PPPPKPPP/RNBQ1BNR w - - 0 4', '00fdd303c946bdd9'],
    ['rnbqkbnr/p1pppppp/8/8/PpP4P/8/1P1PPPP1/RNBQKBNR b KQkq c3 0 3', '3c8123ea7b067637'],
    ['rnbqkbnr/p1pppppp/8/8/P6P/R1p5/1P1PPPP1/1NBQKBNR b Kkq - 0 4', '5c3f9b829b279560'],
  ];
  assert.equal(KEYS.length, 781);
  assert.equal(POSITION_HASH_ALGORITHM, 'polyglot-standard-v1');
  assert.equal(PAWN_HASH_ALGORITHM, 'polyglot-pawns-v1');
  for (const [fen, expected] of vectors) {
    const result = positionFingerprint(fen);
    assert.equal(hex64(result.hash), '0x' + expected, fen);
    assert.equal(result.hash, fromSqliteInt64(result.sqliteHash));
    assert.equal(result.pawnHash, fromSqliteInt64(result.sqlitePawnHash));
    assert.equal(typeof result.hash, 'bigint');
    assert.equal(typeof result.pawnHash, 'bigint');
  }
});

test('transpositions and move counters preserve exact keys; turn and castling do not', () => {
  const a = positionFingerprint(replay('Nf3 Nf6 g3 g6'));
  const b = positionFingerprint(replay('g3 g6 Nf3 Nf6'));
  assert.deepEqual(a, b);
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq -';
  const p = positionFingerprint(fen);
  assert.equal(p.verificationKey, fen);
  assert.equal(positionFingerprint(fen + ' 40 78').hash, p.hash);
  assert.notEqual(positionFingerprint(fen.replace(' w ', ' b ')).hash, p.hash);
  assert.notEqual(positionFingerprint(fen.replace('KQkq', 'Kkq')).hash, p.hash);
  assert.notEqual(positionFingerprint(fen.replace('KQkq', '-')).verificationKey, p.verificationKey);
  assert.equal(samePositionFingerprint(a, b), true);
});

test('Polyglot en-passant differs from legal chessops EPD even if a pawn is pinned', () => {
  // White e5 pawn is pinned against its king by the black rook on e8.
  const pinned = 'k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
  const position = parseSearchPosition(pinned);
  assert.equal(position.toSetup().epSquare, undefined, 'chessops strips illegal EP');
  const withEp = positionFingerprint(position);
  const withoutEp = positionFingerprint(pinned.replace(' d6 ', ' - '));
  assert.equal(withEp.verificationKey, pinned.split(' ').slice(0, 4).join(' '));
  assert.equal(withEp.hash ^ withoutEp.hash, KEYS[772 + 3]);
  assert.equal(withEp.pawnHash, withoutEp.pawnHash);
  assert.equal(withEp.pawnSignature, withoutEp.pawnSignature);
  assert.notEqual(withEp.verificationKey, withoutEp.verificationKey);

  const noAdjacent = positionFingerprint('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3');
  assert.match(noAdjacent.verificationKey, / -$/);
  assert.equal(noAdjacent.hash, positionFingerprint('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -').hash);
});

test('pawn hash/signature ignore turn, castling, non-pawns and counters, but notice pawn moves', () => {
  const start = positionFingerprint(Chess.default());
  const knights = positionFingerprint(replay('Nf3 Nf6'));
  const rights = positionFingerprint('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b - - 50 90');
  for (const value of [knights, rights]) {
    assert.equal(value.pawnHash, start.pawnHash);
    assert.equal(value.pawnSignature, start.pawnSignature);
    assert.ok(samePawnFingerprint(start, value));
    assert.notEqual(value.hash, start.hash);
  }
  const moved = positionFingerprint(replay('e4'));
  assert.notEqual(moved.pawnHash, start.pawnHash);
  assert.notEqual(moved.pawnSignature, start.pawnSignature);
  assert.equal(samePawnFingerprint(start, moved), false);
  assert.match(start.pawnSignature, /^[0-9a-f]{16}:[0-9a-f]{16}$/);
  assert.equal(start.pawnSignature, '000000000000ff00:00ff000000000000');
});

test('promotion and custom initial FEN use the same board keys, without a promotion marker', () => {
  const position = Chess.fromSetup(parseFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1').unwrap()).unwrap();
  const move = parseUci('a7a8q');
  assert.ok(move && position.isLegal(move));
  position.play(move);
  const result = positionFingerprint(position);
  assert.deepEqual(result, positionFingerprint('Q3k3/8/8/8/8/8/8/4K3 b - -'));
});

test('reject malformed and locally impossible search FEN; never silently normalize invalid rights', () => {
  const invalid = [
    'not a fen',
    '8/8/8/8/8/8/8/8 w - -',
    '4k3/8/8/8/8/8/8/4K3 w K -',
    '4k3/8/8/8/8/8/8/4K3 w - e3',
    '4k3/8/8/8/8/8/8/4K3 w - - 0 0',
    '4k3/8/8/8/8/8/8/4K3 w KK -',
    '4k3/8/8/8/8/8/8/P3K3 w - -',
    '4k3/8/8/8/8/8/8/4K3 w A -',
    '4k3/8/8/8/8/8/8/4K3 w - - 0 1 variant',
    '4k3/8/8/8/8/8/8/4K3 w - d6',
  ];
  for (const fen of invalid) assert.throws(() => positionFingerprint(fen), undefined, fen);
  assert.throws(() => positionFingerprint({ rules: 'chess' }), /validated/);
  assert.throws(() => positionFingerprint(null), /validated/);
});

test('separately stored verification keys detect deliberate hash collisions', () => {
  const p = positionFingerprint(Chess.default());
  const forged = { ...p, verificationKey: p.verificationKey.replace(' w ', ' b ') };
  assert.equal(forged.hash, p.hash);
  assert.equal(samePositionFingerprint(p, forged), false);
  const forgedPawns = { ...p, pawnSignature: '0000000000000000:0000000000000000' };
  assert.equal(forgedPawns.pawnHash, p.pawnHash);
  assert.equal(samePawnFingerprint(p, forgedPawns), false);
  assert.throws(() => toSqliteInt64(Number.MAX_SAFE_INTEGER), /bigint/);
  assert.throws(() => JSON.stringify(p), /BigInt/);
});
