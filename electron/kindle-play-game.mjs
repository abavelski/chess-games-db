import { Chess, castlingSide } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseUci, makeUci, kingCastlesTo } from 'chessops/util';

export const initialFen = makeFen(Chess.default().toSetup());
export class PlayError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function validateRating(rating) {
  if (!Number.isInteger(rating) || rating < 600 || rating > 2600 || rating % 100) throw new PlayError(400, 'BAD_REQUEST', 'Rating must be 600..2600 in steps of 100.');
}
// Accept standard UCI at the client boundary. Engine output may also use chessops castles.
export function applyUci(position, uci, engine = false) {
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new PlayError(400, 'BAD_REQUEST', 'Expected a standard UCI move.');
  const move = parseUci(uci);
  if (!position.isLegal(move)) throw new PlayError(422, 'ILLEGAL_MOVE', 'Move is illegal in the current position.');
  const side = castlingSide(position, move);
  const standard = side ? makeUci({ ...move, to: kingCastlesTo(position.turn, side) }) : uci;
  if (!engine && standard !== uci) throw new PlayError(422, 'ILLEGAL_MOVE', 'Castling requires the king destination square.');
  position.play(move);
  return standard;
}
const key = position => makeFen(position.toSetup()).split(' ').slice(0, 4).join(' ');
export function terminalResult(position, repetitions = 1) {
  if (position.isCheckmate()) return { outcome: position.turn === 'white' ? 'black_win' : 'white_win', reason: 'checkmate' };
  if (position.isStalemate()) return { outcome: 'draw', reason: 'stalemate' };
  if (position.isInsufficientMaterial() || position.halfmoves >= 150 || repetitions >= 5) return { outcome: 'draw', reason: 'draw' };
  return null;
}

export class KindlePlayGame {
  #game = null;
  #busy = false;
  snapshot() {
    if (!this.#game) return null;
    const { position, moves, rating, result } = this.#game;
    return { apiVersion: 1, rating, playerColor: 'white', fen: makeFen(position.toSetup()), moves: [...moves], ply: moves.length, status: result ? 'finished' : 'playing', result: result ? { ...result } : null, lastMove: moves.at(-1) ?? null };
  }
  #idle() { if (this.#busy) throw new PlayError(409, 'BUSY', 'Maia is thinking.'); }
  #playing() {
    this.#idle();
    if (!this.#game) throw new PlayError(404, 'NO_GAME', 'Start a game first.');
    if (this.#game.result) throw new PlayError(409, 'GAME_FINISHED', 'The game has finished.');
  }
  start(rating) {
    this.#idle(); validateRating(rating);
    if (this.#game && !this.#game.result) throw new PlayError(409, 'GAME_IN_PROGRESS', 'A game is already playing.');
    const position = Chess.default();
    this.#game = { position, rating, moves: [], result: null, repetitions: new Map([[key(position), 1]]) };
    return this.snapshot();
  }
  async move(uci, expectedPly, provider) {
    this.#playing();
    if (!Number.isInteger(expectedPly) || expectedPly < 0) throw new PlayError(400, 'BAD_REQUEST', 'expectedPly must be a nonnegative integer.');
    if (expectedPly !== this.#game.moves.length) throw new PlayError(409, 'STALE_PLY', 'Refresh the current game before sending a move.');
    const candidate = { ...this.#game, position: this.#game.position.clone(), moves: [...this.#game.moves], repetitions: new Map(this.#game.repetitions) };
    const play = (move, engine = false) => {
      candidate.moves.push(applyUci(candidate.position, move, engine));
      const k = key(candidate.position), count = (candidate.repetitions.get(k) ?? 0) + 1;
      candidate.repetitions.set(k, count);
      candidate.result = terminalResult(candidate.position, count);
    };
    play(uci);
    this.#busy = true;
    try {
      if (!candidate.result) {
        try {
          const reply = await provider({ initialFen, moves: [...candidate.moves], rating: candidate.rating });
          play(reply, true);
        } catch (error) {
          if (error.code === 'ENGINE_TIMEOUT') throw error;
          throw new PlayError(503, 'ENGINE_UNAVAILABLE', 'Maia could not supply a legal move. Check desktop engine setup and logs.');
        }
      }
      this.#game = candidate;
      return this.snapshot();
    } finally { this.#busy = false; }
  }
  resign() {
    this.#playing();
    this.#game.result = { outcome: 'black_win', reason: 'resignation' };
    return this.snapshot();
  }
}
