import { randomUUID } from 'node:crypto';
import { makeSan } from 'chessops/san';
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
  constructor({ now = () => new Date().toISOString(), id = randomUUID, persist = () => {} } = {}) { this.now = now; this.id = id; this.persist = persist; }
  snapshot(game = this.#game) {
    if (!game) return null;
    const { position, moves, sanMoves, rating, result, playerColor, gameId, startedAt, lastMoveAt } = game;
    return { apiVersion: 1, rating, playerColor, gameId, startedAt, lastMoveAt, sanMoves: [...sanMoves], fen: makeFen(position.toSetup()), moves: [...moves], ply: moves.length, status: result ? 'finished' : 'playing', result: result ? { ...result } : null, lastMove: moves.at(-1) ?? null };
  }
  #idle() { if (this.#busy) throw new PlayError(409, 'BUSY', 'Maia is thinking.'); }
  #playing() {
    this.#idle();
    if (!this.#game) throw new PlayError(404, 'NO_GAME', 'Start a game first.');
    if (this.#game.result) throw new PlayError(409, 'GAME_FINISHED', 'The game has finished.');
  }
  #commit(candidate) {
    this.persist(this.snapshot(candidate));
    this.#game = candidate;
    return this.snapshot();
  }
  #play(candidate, move, engine = false) {
    const before = candidate.position.clone();
    const standard = applyUci(candidate.position, move, engine);
    const san = makeSan(before, parseUci(standard));
    candidate.moves.push(standard);
    candidate.sanMoves.push(san);
    const k = key(candidate.position), count = (candidate.repetitions.get(k) ?? 0) + 1;
    candidate.repetitions.set(k, count);
    candidate.result = terminalResult(candidate.position, count);
  }
  async #reply(candidate, provider) {
    try {
      const reply = await provider({ initialFen, moves: [...candidate.moves], rating: candidate.rating });
      this.#play(candidate, reply, true);
    } catch (error) {
      if (error.code === 'ENGINE_TIMEOUT') throw error;
      throw new PlayError(503, 'ENGINE_UNAVAILABLE', 'Maia could not supply a legal move. Check desktop engine setup and logs.');
    }
  }
  start(rating, playerColor = 'white', provider) {
    this.#idle(); validateRating(rating);
    if (!['white', 'black'].includes(playerColor)) throw new PlayError(400, 'BAD_REQUEST', 'playerColor must be white or black.');
    if (this.#game && !this.#game.result) throw new PlayError(409, 'GAME_IN_PROGRESS', 'A game is already playing.');
    const position = Chess.default();
    const candidate = { position, rating, playerColor, gameId: this.id(), startedAt: null, lastMoveAt: null, moves: [], sanMoves: [], result: null, repetitions: new Map([[key(position), 1]]) };
    const publish = () => { candidate.startedAt = this.now(); if (candidate.moves.length) candidate.lastMoveAt = candidate.startedAt; return this.#commit(candidate); };
    if (playerColor === 'white') return publish();
    this.#busy = true;
    return this.#reply(candidate, provider).then(publish).finally(() => { this.#busy = false; });
  }
  async move(uci, expectedPly, provider) {
    this.#playing();
    if (!Number.isInteger(expectedPly) || expectedPly < 0) throw new PlayError(400, 'BAD_REQUEST', 'expectedPly must be a nonnegative integer.');
    if (expectedPly !== this.#game.moves.length) throw new PlayError(409, 'STALE_PLY', 'Refresh the current game before sending a move.');
    if (this.#game.position.turn !== this.#game.playerColor) throw new PlayError(409, 'BUSY', 'Wait for your turn.');
    const candidate = { ...this.#game, position: this.#game.position.clone(), moves: [...this.#game.moves], sanMoves: [...this.#game.sanMoves], repetitions: new Map(this.#game.repetitions) };
    this.#play(candidate, uci);
    this.#busy = true;
    try {
      if (!candidate.result) await this.#reply(candidate, provider);
      candidate.lastMoveAt = this.now();
      return this.#commit(candidate);
    } finally { this.#busy = false; }
  }
  resign() {
    this.#playing();
    return this.#commit({ ...this.#game, result: { outcome: this.#game.playerColor === 'white' ? 'black_win' : 'white_win', reason: 'resignation' } });
  }
}
