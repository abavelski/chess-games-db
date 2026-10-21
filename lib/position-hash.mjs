import { Chess, isImpossibleCheck, isStandardMaterial } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { KEYS } from './polyglot-keys.mjs';

// Standard chess only. Neither the hash nor the verification key is compatible
// with electron/openings.mjs (which uses chessops' *legal* en-passant FEN).
export const POSITION_HASH_ALGORITHM = 'polyglot-standard-v1';
export const PAWN_HASH_ALGORITHM = 'polyglot-pawns-v1';

const ROLE_ORDER = Object.freeze({
  pawn: 0, knight: 1, bishop: 2, rook: 3, queen: 4, king: 5,
});
const CORNERS = [0, 7, 56, 63];
const FILES = 'abcdefgh';

// Chess.fromSetup() deliberately tolerates some impossible FEN metadata (it
// discards invalid castling rights and en-passant targets). Search must not.
export function parseSearchPosition(fen) {
  if (typeof fen !== 'string') throw new TypeError('Expected a standard-chess FEN');
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 4 && fields.length !== 6) throw new Error('Expected a four- or six-field FEN');
  const [board, turn, castling, ep] = fields;
  if (!/^[prnbqkPRNBQK1-8/]+$/.test(board) ||
      !/^[wb]$/.test(turn) ||
      !/^(?:-|[KQkq]{1,4})$/.test(castling) ||
      (castling !== '-' && new Set(castling).size !== castling.length) ||
      !/^(?:-|[a-h][36])$/.test(ep)) {
    throw new Error('Invalid standard-chess FEN fields');
  }
  if (fields.length === 6 &&
      (!/^\d+$/.test(fields[4]) || !/^[1-9]\d*$/.test(fields[5]))) {
    throw new Error('Invalid FEN move counters');
  }
  const setup = parseFen(fen).unwrap();
  const position = Chess.fromSetup(setup).unwrap();
  if (setup.pockets || setup.remainingChecks ||
      !setup.castlingRights.equals(position.castles.castlingRights) ||
      setup.epSquare !== position.epSquare) {
    throw new Error('Impossible standard-chess FEN metadata');
  }
  requireStandardCastling(position);
  if (!isStandardMaterial(position) || isImpossibleCheck(position)) {
    throw new Error('Impossible standard-chess position');
  }
  return position;
}

function requireStandardCastling(position) {
  const rights = position.castles.castlingRights;
  for (const square of rights) {
    if (!CORNERS.includes(square)) throw new Error('Chess960 castling is not supported');
    const color = square < 8 ? 'white' : 'black';
    const king = position.board.get(color === 'white' ? 4 : 60);
    if (king?.role !== 'king' || king.color !== color) {
      throw new Error('Impossible standard-chess castling rights');
    }
  }
}

// chessops Position.toSetup() calls legalEpSquare(), which drops pinned-pawn
// captures. Polyglot requires a geometrically adjacent pawn *even if pinned*.
// Use position.epSquare, the validated pseudo-legal target, instead.
function polyglotEpSquare(position) {
  const square = position.epSquare;
  if (square === undefined) return undefined;
  const file = square % 8;
  const pawnRank = square + (position.turn === 'white' ? -8 : 8);
  for (const neighborFile of [file - 1, file + 1]) {
    if (neighborFile < 0 || neighborFile > 7) continue;
    const neighbor = pawnRank + neighborFile - file;
    const piece = position.board.get(neighbor);
    if (piece?.role === 'pawn' && piece.color === position.turn) return square;
  }
  return undefined;
}

export function toSqliteInt64(unsigned) {
  if (typeof unsigned !== 'bigint' || unsigned < 0n || unsigned > 0xffffffffffffffffn) {
    throw new TypeError('Expected an unsigned 64-bit bigint');
  }
  return BigInt.asIntN(64, unsigned);
}

export function fromSqliteInt64(signed) {
  if (typeof signed !== 'bigint' || signed !== BigInt.asIntN(64, signed)) {
    throw new TypeError('Expected a signed 64-bit bigint');
  }
  return BigInt.asUintN(64, signed);
}

export function hex64(unsigned) {
  return '0x' + BigInt.asUintN(64, unsigned).toString(16).padStart(16, '0');
}

// Caller passes a validated standard Chess position from PGN replay, or a FEN
// which is parsed and checked here. Does not mutate the supplied position.
export function positionFingerprint(positionOrFen) {
  const position = typeof positionOrFen === 'string'
    ? parseSearchPosition(positionOrFen)
    : positionOrFen;
  if (!(position instanceof Chess) || position.rules !== 'chess') {
    throw new TypeError('Expected a validated standard chessops Chess position or FEN');
  }
  requireStandardCastling(position);
  let hash = 0n, pawnHash = 0n, white = 0n, black = 0n;
  for (let square = 0; square < 64; square++) {
    const piece = position.board.get(square);
    if (!piece) continue;
    const role = ROLE_ORDER[piece.role];
    if (role === undefined) throw new TypeError('Unsupported chess piece');
    const key = KEYS[(role * 2 + (piece.color === 'white' ? 1 : 0)) * 64 + square];
    hash ^= key;
    if (piece.role === 'pawn') {
      pawnHash ^= key;
      if (piece.color === 'white') white |= 1n << BigInt(square);
      else black |= 1n << BigInt(square);
    }
  }
  const rights = position.castles.castlingRights;
  if (rights.has(7)) hash ^= KEYS[768];  // White K
  if (rights.has(0)) hash ^= KEYS[769];  // White Q
  if (rights.has(63)) hash ^= KEYS[770]; // Black k
  if (rights.has(56)) hash ^= KEYS[771]; // Black q
  const epSquare = polyglotEpSquare(position);
  if (epSquare !== undefined) hash ^= KEYS[772 + epSquare % 8];
  if (position.turn === 'white') hash ^= KEYS[780];

  // Retain a four-field collision check independent of chessops legal-EP EPD.
  const verificationKey = makeFen({ ...position.toSetup(), epSquare }, { epd: true });
  return {
    hash,
    sqliteHash: toSqliteInt64(hash),
    verificationKey,
    pawnHash,
    sqlitePawnHash: toSqliteInt64(pawnHash),
    // Exact two-color bitboards; bit 0=a1, bit 63=h8. No hash collisions.
    pawnSignature: white.toString(16).padStart(16, '0') + ':' +
      black.toString(16).padStart(16, '0'),
  };
}

// Only compare full keys after an indexed hash lookup; never trust the hash
// alone, including for pawn-structure lookups.
export function samePositionFingerprint(a, b) {
  return a.hash === b.hash && a.verificationKey === b.verificationKey;
}

export function samePawnFingerprint(a, b) {
  return a.pawnHash === b.pawnHash && a.pawnSignature === b.pawnSignature;
}
