import test from 'node:test';
import assert from 'node:assert/strict';
import { parseComment, parsePgn } from 'chessops/pgn';
import { commentText, prepareDisplayPgn, reviewPgn } from '../src/pgn.mjs';

test('pre/post annotations become prose, including language tags and paragraphs', () => {
  assert.equal(commentText('[%pre:ENG Another idea]\n[%post This works.]'), 'Another idea\nThis works.');
  const pgn = '{ Introduction } 1. e4 { [%post:ENG Center control.] } ({ [%pre Another approach:] } 1. d4 { Queen pawn. }) e5 { Final note. } *';
  const review = reviewPgn(pgn);
  assert.deepEqual(review.tokens.filter(t => t.type === 'comment').map(t => t.text),
    ['Introduction', 'Center control.', 'Another approach:', 'Queen pawn.', 'Final note.']);
  assert.deepEqual(review.tokens.filter(t => t.type === 'move').map(t => t.san), ['e4', 'd4', 'e5']);
  assert.ok(!review.displayPgn.includes('[%pre'));
  assert.ok(!review.displayPgn.includes('[%post'));
});

test('colored arrows and square highlights stay in board PGN and out of prose', () => {
  const text = '[%cal Gb6a4, Yc3a4] [%csl Ra4,Bb5] Two attackers.';
  assert.equal(commentText(text), 'Two attackers.');
  const prepared = prepareDisplayPgn(`1. e4 { ${text} } *`);
  const comment = parsePgn(prepared)[0].moves.children[0].data.comments[0];
  const shapes = parseComment(comment).shapes;
  assert.equal(shapes.length, 4);
  assert.deepEqual(shapes.map(s => s.color), ['green', 'yellow', 'red', 'blue']);
});

test('lossless cbtext backups display once as plain text, never HTML', () => {
  const text = 'A {nested} note.\n<script>alert("test")</script>';
  const encoded = Buffer.from(text).toString('base64');
  assert.equal(commentText(`A ｛nested｝ note. [%cbtext ${encoded}]`), text);
  assert.equal(commentText('Readable fallback [%cbtext /w==]'), 'Readable fallback');
  assert.equal(commentText('[%crit endgame] [%train AQAB] Keep playing.'), 'Critical position · endgame.  Training exercise.  Keep playing.');
});

test('nested and final-move variations retain all their text and distinct navigation paths', () => {
  const review = reviewPgn('1. e4 (1. d4 d5 (1... Nf6 { Nested note. })) e5 (1... c5 { Final variation note. }) *');
  const moves = review.tokens.filter(t => t.type === 'move');
  assert.deepEqual(moves.map(m => m.san), ['e4', 'd4', 'd5', 'Nf6', 'e5', 'c5']);
  assert.equal(new Set(moves.map(m => m.path)).size, moves.length);
  assert.deepEqual(review.tokens.filter(t => t.type === 'comment').map(t => t.text), ['Nested note.', 'Final variation note.']);
});

test('setup positions, commentary-only records, and illegal moves retain their text', () => {
  const setup = reviewPgn('[SetUp "1"]\n[FEN "8/8/8/8/8/8/4K3/7k b - - 0 24"]\n\n24... Kh2 { A king move. } *');
  assert.equal(setup.tokens.find(t => t.type === 'move').ply, 48);
  assert.ok(setup.tokens.find(t => t.type === 'move').path);
  const text = reviewPgn('{ [%pre Chapter heading]\nA complete text passage. } *');
  assert.equal(text.tokens[0].text, 'Chapter heading\nA complete text passage.');
  const illegal = reviewPgn('1. e4 e5 2. Ke5 { Original note after an illegal move. } Nc6 { Still readable. } *');
  assert.equal(illegal.tokens.find(t => t.san === 'Ke5').path, null);
  assert.equal(illegal.tokens.find(t => t.san === 'Nc6').path, null);
  assert.equal(illegal.tokens.at(-1).text, 'Still readable.');
});

test('numeric and mate evaluations belong to their move without replacing commentary', () => {
  const pgn = '1. e4 $14 { [%eval +0.35,18] Keep the center. } (1. d4 { [%eval #3] }) e5 { [%eval 0.00] } 2. Nf3 { [%eval -0.80/10] } Nc6 { [%eval #-2] } *';
  const review = reviewPgn(pgn);
  const moves = review.tokens.filter(t => t.type === 'move');
  assert.deepEqual(moves.map(m => m.evaluations), [
    [{ value: '+0.35', depth: 18 }], [{ value: '#3', depth: undefined }],
    [{ value: '0.00', depth: undefined }], [{ value: '-0.80', depth: 10 }],
    [{ value: '#-2', depth: undefined }],
  ]);
  assert.deepEqual(moves[0].nags, [14]);
  assert.deepEqual(review.tokens.filter(t => t.type === 'comment').map(t => t.text), ['Keep the center.']);
  assert.equal(commentText('[%eval unknown]'), 'Evaluation: unknown');
});


test('critical markers belong to moves, including variations and restored comments', () => {
  const backup = Buffer.from('[%crit endgame] Find a plan.').toString('base64');
  const review = reviewPgn(`1. e4 {[%crit opening] Center.} ({[%crit middlegame]} 1. d4 {[%crit MIDDLEGAME] [%train AQAB]}) e5 {Fallback [%cbtext ${backup}]} 2. Nf3 {[%crit unknown]} *`);
  const moves = review.tokens.filter(t => t.type === 'move');
  assert.deepEqual(moves.map(t => t.critical), [['opening'], ['middlegame'], ['endgame'], []]);
  assert.deepEqual(review.tokens.filter(t => t.type === 'comment').map(t => t.text),
    ['Center.', 'Training exercise.', 'Find a plan.', 'Critical position · unknown.']);
  assert.ok(review.displayPgn.includes('Critical position · opening.'));
  assert.ok(reviewPgn('{[%crit opening]} *').tokens[0].text.includes('Critical position'));
});
