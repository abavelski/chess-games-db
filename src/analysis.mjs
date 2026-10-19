import { Chess, normalizeMove } from 'chessops/chess';
import { parseFen, makeFen } from 'chessops/fen';
import { parseUci, makeUci } from 'chessops/util';
import { makeSanAndPlay } from 'chessops/san';

export function replayPosition(initialFen, moves) {
  const position = Chess.fromSetup(parseFen(initialFen).unwrap()).unwrap();
  const sans = [];
  for (const uci of moves) {
    const move = parseUci(uci);
    if (!move || !position.isLegal(move)) throw new Error(`Illegal analysis move: ${uci}`);
    sans.push(makeSanAndPlay(position, move));
  }
  return { initialFen, moves: [...moves], fen: makeFen(position.toSetup()), turn: position.turn, sans, position };
}
export function sourcePosition(viewer) {
  const moves = [];
  let node = viewer.game.moves;
  for (let length = 2; length <= viewer.path.path.length; length += 2) {
    node = node.children.find(child => child.data.path.path === viewer.path.path.slice(0, length));
    if (!node?.data?.uci) throw new Error('Cannot reconstruct position history');
    moves.push(node.data.uci);
  }
  return replayPosition(viewer.game.initial.fen, moves);
}
export function appendMove(current, from, to, promotion = 'queen') {
  const position = current.position.clone();
  const move = parseUci(from + to);
  if (!move || !('from' in move)) throw new Error('Invalid move');
  const piece = position.board.get(move.from);
  if (piece?.role === 'pawn' && (to[1] === '1' || to[1] === '8')) move.promotion = promotion;
  if (!position.isLegal(move)) throw new Error('Illegal move');
  return replayPosition(current.initialFen, [...current.moves, makeUci(normalizeMove(position, move))]);
}
export function linePreview(current, moves) {
  const valid = [];
  for (const move of moves) {
    try { const next = replayPosition(current.initialFen, [...current.moves, ...valid, move]); valid.push(move); if (next.position.isEnd()) break; }
    catch { break; }
  }
  const result = replayPosition(current.initialFen, [...current.moves, ...valid]);
  return result.sans.slice(current.moves.length).map((san, index) => ({ san, moves: [...current.moves, ...valid.slice(0, index + 1)] }));
}
export function analysisKey(current, engine, settings) {
  return JSON.stringify([current.initialFen, current.moves, engine, settings]);
}
