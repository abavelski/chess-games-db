import { normalizeMove } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseUci, makeUci } from 'chessops/util';
import { makeSan } from 'chessops/san';
import { parseSearchPosition, positionFingerprint } from '../lib/position-hash.mjs';

export const OPENING_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export function openingBoard(initialFen = OPENING_START_FEN, moves = []) {
  const position = parseSearchPosition(initialFen), sans = [];
  if (!Array.isArray(moves) || moves.length > 2048) throw new Error('Move path exceeds limit');
  for (const uci of moves) {
    const move = parseUci(uci);
    if (!move || !position.isLegal(move)) throw new Error('Illegal opening move');
    sans.push(makeSan(position, move)); position.play(move);
  }
  return { position, sans, fen: makeFen({ ...position.toSetup(), epSquare: position.epSquare }),
    turn: position.turn, exactKey: positionFingerprint(position).verificationKey };
}
export function appendOpeningMove(route, uci) {
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('Enter a legal UCI move, such as e2e4');
  const board = openingBoard(route.rootFen, route.moves), move = parseUci(uci);
  if (!move || !board.position.isLegal(move)) throw new Error('That move is illegal in the current position');
  return { ...route, moves: [...route.moves, makeUci(normalizeMove(board.position, move))] };
}
export function openingAnchor(route, fen) {
  openingBoard(fen, []); // Strict validation: never repair source/user metadata.
  return { ...route, mode: 'position', rootFen: fen, moves: [] };
}
