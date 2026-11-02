import test from 'node:test';
import assert from 'node:assert/strict';
import { replayPosition, appendMove } from '../src/analysis.mjs';
import { startPieceGame, chooseMaiaMove, pieceGameResult } from '../src/piece-game.mjs';

const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
test('starting from a free setup validates kings, pawns, side to move and castling history', () => {
  assert.equal(startPieceGame(start, start.split(' ')[0], 'white').fen, start);
  assert.equal(startPieceGame(start, start.split(' ')[0], 'black', [4]).fen.split(' ')[2], 'kq');
  assert.equal(startPieceGame(start, start.split(' ')[0], 'white', [7]).fen.split(' ')[2], 'Qkq');
  assert.throws(() => startPieceGame(start, '8/8/8/8/8/8/8/4K3', 'white'));
  assert.throws(() => startPieceGame(start, '4k3/8/8/8/8/8/8/P3K3', 'white'));
  assert.throws(() => startPieceGame(start, '4k3/8/8/8/8/8/8/K3R3', 'white'));
  assert.equal(startPieceGame(start, '4k3/8/8/8/8/8/8/K3R3', 'black').turn, 'black');
});
test('a legal continuation preserves original en passant; free edits clear it', () => {
  const original = replayPosition(start, ['e2e4','a7a6','e4e5','d7d5']).fen;
  const pieces = original.split(' ')[0];
  assert.equal(startPieceGame(original, pieces, 'white').fen.split(' ')[3], 'd6');
  assert.equal(startPieceGame(original, pieces, 'white', [1, 18]).fen.split(' ')[3], '-');
});
test('Maia selects only legal candidates by policy weight and never mutates the source', () => {
  const current = replayPosition(start, []);
  const candidates = [{ move:'e2e5',probability:99 },{ move:'e2e4',probability:0.7 },{ move:'d2d4',probability:0.3 }];
  assert.deepEqual(chooseMaiaMove(current, candidates, () => 0).moves, ['e2e4']);
  assert.deepEqual(chooseMaiaMove(current, candidates, () => 0.99).moves, ['d2d4']);
  assert.deepEqual(current.moves, []);
  assert.throws(() => chooseMaiaMove(current, [{move:'e2e5',probability:1}]));
});
test('castling, en passant and promotion use the same legal replay as review', () => {
  const castle = replayPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', []);
  assert.match(appendMove(castle, 'e1','g1').fen, /R4RK1 b/);
  const ep = replayPosition(start, ['e2e4','a7a6','e4e5','d7d5']);
  assert.match(appendMove(ep, 'e5','d6').fen, /^rnbqkbnr\/1pp1pppp\/p2P4\//);
  const promote = replayPosition('7k/P7/8/8/8/8/8/7K w - - 0 1', []);
  assert.match(appendMove(promote, 'a7','a8','knight').fen, /^N6k\//);
});
test('end states and claimable/automatic draws stop legal play', () => {
  assert.match(pieceGameResult(replayPosition('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', [])).text, /Checkmate/);
  assert.match(pieceGameResult(replayPosition('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', [])).text, /stalemate/);
  assert.match(pieceGameResult(replayPosition('7k/8/8/8/8/8/8/7K w - - 0 1', [])).text, /insufficient/);
  const cycle = ['g1f3','g8f6','f3g1','f6g8'];
  assert.equal(pieceGameResult(replayPosition(start, [...cycle,...cycle])).claim, 'threefold repetition');
  assert.equal(pieceGameResult(replayPosition(start, [...cycle,...cycle,...cycle,...cycle])).ended, true);
  assert.equal(pieceGameResult(replayPosition(start.replace('0 1','100 51'), [])).claim, '50-move rule');
  assert.equal(pieceGameResult(replayPosition(start.replace('0 1','150 76'), [])).ended, true);
});
