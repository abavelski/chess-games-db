import { Chess, normalizeMove } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeUci, parseUci } from 'chessops/util';
import { parseSearchPosition } from '../lib/position-hash.mjs';
import { replayPosition } from './analysis.mjs';

export function startPieceGame(originalFen, pieces, turn, touched = []) {
  const original = parseFen(originalFen).unwrap();
  if (!['white', 'black'].includes(turn)) throw new Error('Invalid side to move');
  const setup = parseFen(`${pieces} ${turn === 'white' ? 'w' : 'b'} - - 0 ${original.fullmoves}`).unwrap();
  setup.castlingRights = original.castlingRights;
  // Free moves cannot retain castling rights for a king/rook that was moved,
  // captured or replaced, even if the pieces were later put back.
  for (const square of touched) {
    setup.castlingRights = setup.castlingRights.without(square);
    if (square === 4) setup.castlingRights = setup.castlingRights.without(0).without(7);
    if (square === 60) setup.castlingRights = setup.castlingRights.without(56).without(63);
  }
  if (pieces === originalFen.split(' ')[0] && turn === original.turn && !touched.length) {
    setup.epSquare = original.epSquare;
    setup.halfmoves = original.halfmoves;
  }
  const position = Chess.fromSetup(setup).unwrap();
  const fen = makeFen(position.toSetup());
  parseSearchPosition(fen);
  return replayPosition(fen, []);
}

export function chooseMaiaMove(current, candidates, random = Math.random) {
  const legal = candidates.filter(candidate => {
    const move = parseUci(candidate.move);
    return move && current.position.isLegal(move) && Number.isFinite(candidate.probability) && candidate.probability > 0;
  });
  const total = legal.reduce((sum, candidate) => sum + candidate.probability, 0);
  if (!total) throw new Error('Maia returned no legal moves. Retry or return to free mode.');
  let sample = random() * total;
  const chosen = legal.find(candidate => (sample -= candidate.probability) < 0) ?? legal.at(-1);
  const move = makeUci(normalizeMove(current.position, parseUci(chosen.move)));
  return replayPosition(current.initialFen, [...current.moves, move]);
}

export function pieceGameResult(current) {
  const position = current.position;
  if (position.isCheckmate()) return { ended: true, text: `Checkmate — ${current.turn === 'white' ? 'Black' : 'White'} wins.`, claim: null };
  if (position.isStalemate()) return { ended: true, text: 'Draw — stalemate.', claim: null };
  if (position.isInsufficientMaterial()) return { ended: true, text: 'Draw — insufficient material.', claim: null };
  if (position.halfmoves >= 150) return { ended: true, text: 'Draw — 75-move rule.', claim: null };
  const repeated = new Map();
  const replay = Chess.fromSetup(parseFen(current.initialFen).unwrap()).unwrap();
  const count = () => {
    const key = makeFen(replay.toSetup()).split(' ').slice(0, 4).join(' ');
    repeated.set(key, (repeated.get(key) ?? 0) + 1);
    return repeated.get(key);
  };
  let repetitions = count();
  for (const uci of current.moves) { replay.play(parseUci(uci)); repetitions = count(); }
  if (repetitions >= 5) return { ended: true, text: 'Draw — fivefold repetition.', claim: null };
  return { ended: false, text: `${current.turn === 'white' ? 'White' : 'Black'} to move${position.isCheck() ? ' — check' : ''}.`,
    claim: repetitions >= 3 ? 'threefold repetition' : position.halfmoves >= 100 ? '50-move rule' : null };
}
