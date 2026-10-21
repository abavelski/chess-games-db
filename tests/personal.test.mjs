import { criticalReveal } from '../src/critical-positions.mjs';
﻿import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePersonal, validatePersonal, emptyPersonal, personalReviewTokens, removePersonalMove, updatePersonalComment } from '../src/personal.mjs';
import { reviewPgn } from '../src/pgn.mjs';

const pgn = '1.e4 {Book note} (1.d4 d5) e5 2.Nf3 *';
test('personal lines reuse book moves and forks, retain branches and mark only new moves', () => {
  const personal = { lines: [['e2e4', 'e7e5'], ['d2d4', 'd7d5'], ['e2e4', 'c7c5', 'g1f3'], ['e2e4', 'c7c5', 'b1c3']], comments: [] };
  const merged = mergePersonal(pgn, personal), tokens = reviewPgn(merged.pgn).tokens;
  assert.equal(tokens.filter(t => t.san === 'e4').length, 1);
  assert.equal(tokens.filter(t => t.san === 'd4').length, 1);
  assert.equal(tokens.filter(t => t.san === 'c5').length, 1);
  assert.equal(merged.ownPaths.size, 3);
  assert.ok(tokens.some(t => t.text === 'Book note'));
  assert.ok(tokens.some(t => t.san === 'Nc3'));
  assert.equal(mergePersonal(pgn, emptyPersonal()).pgn, pgn);
});
test('personal comments support root, book variation and own line, preserving arbitrary text', () => {
  const personal = { lines: [['e2e4', 'c7c5']], comments: [
    { moves: [], text: 'Starting idea {[%crit opening]} <script> ♞' },
    { moves: ['d2d4', 'd7d5'], text: 'Book variation note' },
    { moves: ['e2e4', 'c7c5'], text: 'My Sicilian' },
  ] };
  const merged = mergePersonal(pgn, validatePersonal(personal, pgn));
  assert.equal(merged.comments.get(''), personal.comments[0].text);
  assert.equal(merged.comments.size, 3);
  assert.ok(!merged.pgn.includes('My Sicilian'), 'Personal comments stay separate from book annotations');
});
test('custom starts and all promotion choices have distinct personal paths', () => {
  const start = '[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 25"]\n\n25.a8=Q+ *';
  const merged = mergePersonal(start, { lines: [['a7a8q'], ['a7a8n'], ['a7a8r'], ['a7a8b']], comments: [] });
  assert.equal(merged.ownPaths.size, 3);
  assert.equal(reviewPgn(merged.pgn).tokens.filter(t => t.type === 'move').length, 4);
});
test('rejects malformed histories, illegal moves and comments on missing positions', () => {
  for (const value of [null, {}, { lines: [['e2e5']], comments: [] }, { lines: [], comments: [{ moves: ['e2e4', 'c7c5'], text: 'missing' }] }, { lines: [], comments: [{ moves: [], text: ' ' }] }]) {
    assert.throws(() => validatePersonal(value, pgn));
  }
});

test('castling uses the same path for king destination and rook destination notation', () => {
  const start = '[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1.O-O *';
  const merged = mergePersonal(start, { lines: [['e1g1']], comments: [{ moves: ['e1g1'], text: 'Castled' }] });
  assert.equal(merged.ownPaths.size, 0);
  assert.equal(reviewPgn(merged.pgn).tokens.filter(t => t.type === 'move').length, 1);
});


test('study keeps personal branches selectable while hiding subsequent book moves and annotations', () => {
  const book = '1.e4 {[%crit opening] Hidden solution} e5 2.Nf3 *';
  const merged = mergePersonal(book, { lines: [['e2e4', 'c7c5', 'g1f3'], ['c2c4', 'e7e5']], comments: [] });
  const tokens = reviewPgn(merged.pgn).tokens;
  const visible = personalReviewTokens(tokens, merged.ownPaths, criticalReveal(tokens));
  assert.equal(visible.filter(t => t.type === 'move').length, 5);
  assert.ok(visible.some(t => t.san === 'c5'));
  assert.ok(!visible.some(t => t.text?.includes('Hidden solution')));
  assert.equal(visible.filter(t => t.type === 'variation-start').length, visible.filter(t => t.type === 'variation-end').length);
  assert.ok(!visible.some(t => t.type === 'move' && !merged.ownPaths.has(t.path) && t.san !== 'e4'));
});


test('editing or deleting a comment affects only that position and preserves comment ordering', () => {
  const personal = { lines: [['e2e4', 'c7c5']], comments: [{ moves: [], text: 'Root' }, { moves: ['e2e4'], text: 'Original' }] };
  const updated = updatePersonalComment(personal, ['e2e4'], 'Edited');
  assert.equal(updated.comments[1].text, 'Edited');
  assert.equal(personal.comments[1].text, 'Original');
  assert.deepEqual(updatePersonalComment(updated, ['e2e4'], '').comments, [{ moves: [], text: 'Root' }]);
  assert.deepEqual(updated.lines, personal.lines);
  assert.deepEqual(updatePersonalComment(personal, ['e2e4'], 'Original'), personal);
});

test('trimming personal subtrees retains earlier moves, siblings and unrelated comments', () => {
  const personal = { lines: [['e2e4', 'c7c5', 'g1f3', 'b8c6'], ['e2e4', 'c7c5', 'b1c3'], ['d2d4', 'd7d5', 'c2c4']], comments: [
    { moves: [], text: 'Root' }, { moves: ['e2e4', 'c7c5'], text: 'Parent' },
    { moves: ['e2e4', 'c7c5', 'g1f3'], text: 'Removed' }, { moves: ['e2e4', 'c7c5', 'g1f3', 'b8c6'], text: 'Descendant' },
    { moves: ['e2e4', 'c7c5', 'b1c3'], text: 'Sibling' },
  ] };
  const trimmed = removePersonalMove(pgn, personal, ['e2e4', 'c7c5', 'g1f3']);
  assert.deepEqual(trimmed.lines, [['e2e4', 'c7c5', 'b1c3'], ['d2d4', 'd7d5', 'c2c4']]);
  assert.deepEqual(trimmed.comments.map(c => c.text), ['Root', 'Parent', 'Sibling']);
  assert.deepEqual(validatePersonal(trimmed, pgn), trimmed);
  const leaf = removePersonalMove(pgn, personal, ['e2e4', 'c7c5', 'g1f3', 'b8c6']);
  assert.deepEqual(leaf.lines[0], ['e2e4', 'c7c5', 'g1f3']);
  const branch = removePersonalMove(pgn, personal, ['e2e4', 'c7c5']);
  assert.deepEqual(branch.lines, [['d2d4', 'd7d5', 'c2c4']]);
  assert.deepEqual(branch.comments.map(c => c.text), ['Root']);
  assert.throws(() => removePersonalMove(pgn, personal, ['e2e4']), /Only personal/);
  assert.equal(personal.lines[0].length, 4, 'Original analysis is unchanged');
});
