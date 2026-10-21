import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSquare, parseUci } from 'chessops/util';
import { appendMove, replayPosition } from './analysis.mjs';

// Pure state model shared by the desktop search board and unit tests.
// Standard chess only; all moves use the same chessops contract as review.
export const INITIAL_POSITION_FEN = makeFen(Chess.default().toSetup());
export const POSITION_FILES = 'abcdefgh';

export function positionBoard(moves = []) {
  if (!Array.isArray(moves) || moves.length > 2048 || moves.some(move =>
    typeof move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))) {
    throw new Error('Invalid position-search move history');
  }
  return replayPosition(INITIAL_POSITION_FEN, moves);
}

export function positionPiece(board, square) {
  const index = parseSquare(square);
  return index === undefined ? undefined : board.position.board.get(index);
}

export function positionLegalTargets(board, from) {
  const piece = positionPiece(board, from);
  if (!piece || piece.color !== board.position.turn || board.position.isEnd()) return [];
  const targets = [];
  for (let rank = 1; rank <= 8; rank++) for (const file of POSITION_FILES) {
    const to = file + rank;
    const promotes = piece.role === 'pawn' && (rank === 1 || rank === 8);
    const move = parseUci(from + to + (promotes ? 'q' : ''));
    if (move && board.position.isLegal(move)) targets.push(to);
  }
  return targets;
}

export function positionNeedsPromotion(board, from, to) {
  const piece = positionPiece(board, from);
  return piece?.role === 'pawn' && (to.endsWith('1') || to.endsWith('8')) &&
    positionLegalTargets(board, from).includes(to);
}

export function playPositionMove(moves, from, to, promotion = 'queen') {
  if (!['queen', 'rook', 'bishop', 'knight'].includes(promotion)) {
    throw new Error('Invalid promotion piece');
  }
  const current = positionBoard(moves);
  if (!positionLegalTargets(current, from).includes(to)) throw new Error('Illegal move');
  // appendMove normalizes castling and verifies legality again before replay.
  return appendMove(current, from, to, promotion).moves;
}
