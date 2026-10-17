import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewPgn } from '../src/pgn.mjs';
import { criticalNavigation } from '../src/critical-positions.mjs';

test('critical navigation follows score order through branches and stops at boundaries', () => {
  const { tokens } = reviewPgn('1.e4 {[%crit opening]} (1.d4 {[%crit middlegame]} d5) e5 2.Nf3 {[%crit endgame]} Nc6 *');
  const moves = tokens.filter(t => t.type === 'move');
  const [first, variation, , between, last, end] = moves;
  assert.deepEqual(criticalNavigation(tokens, ''), { total: 3, current: 0, previous: null, next: first.path });
  assert.deepEqual(criticalNavigation(tokens, first.path), { total: 3, current: 1, previous: null, next: variation.path });
  assert.deepEqual(criticalNavigation(tokens, variation.path), { total: 3, current: 2, previous: first.path, next: last.path });
  assert.deepEqual(criticalNavigation(tokens, between.path), { total: 3, current: 0, previous: variation.path, next: last.path });
  assert.deepEqual(criticalNavigation(tokens, last.path), { total: 3, current: 3, previous: variation.path, next: null });
  assert.deepEqual(criticalNavigation(tokens, end.path), { total: 3, current: 0, previous: last.path, next: null });
});

test('unreachable critical annotations remain visible but cannot be navigation targets', () => {
  const { tokens } = reviewPgn('1.e4 e5 2.Ke5 {[%crit middlegame]} *');
  assert.deepEqual(tokens.find(t => t.san === 'Ke5').critical, ['middlegame']);
  assert.deepEqual(criticalNavigation(tokens, ''), { total: 0, current: 0, previous: null, next: null });
  assert.deepEqual(criticalNavigation([], ''), { total: 0, current: 0, previous: null, next: null });
});

import { criticalReveal } from '../src/critical-positions.mjs';

test('study reveals consecutive score prefixes, including branches, then the full game', () => {
  const { tokens } = reviewPgn('1.e4 {[%crit opening] Solution one} (1.d4 {[%crit middlegame]} d5) e5 2.Nf3 {[%crit endgame]} Nc6 *');
  const first = criticalReveal(tokens);
  assert.equal(first.paused, true);
  assert.equal(first.tokens.at(-1).san, 'e4');
  assert.ok(!first.tokens.some(t => t.text?.includes('Solution')));
  const branch = criticalReveal(tokens, 1);
  assert.equal(branch.tokens.at(-1).san, 'd4');
  assert.ok(!first.allowedPaths.has(branch.path));
  assert.ok(branch.allowedPaths.has(first.path));
  assert.equal(criticalReveal(tokens, 2).tokens.at(-1).san, 'Nf3');
  const end = criticalReveal(tokens, 3);
  assert.equal(end.paused, false);
  assert.equal(end.tokens, tokens);
  assert.equal(end.path, tokens.find(t => t.san === 'Nc6').path);
  assert.equal(criticalReveal(tokens, 0, false).tokens, tokens);
});

test('unknown and illegal markers do not create study stops', () => {
  for (const pgn of ['1.e4 {[%crit unknown]} *', '1.e4 e5 2.Ke5 {[%crit middlegame]} *', '{Just text} *']) {
    const { tokens } = reviewPgn(pgn);
    assert.equal(criticalReveal(tokens).paused, false);
    assert.equal(criticalReveal(tokens).tokens, tokens);
  }
});


import { criticalRevealStage } from '../src/critical-positions.mjs';

test('enabling study chooses the next marker after the current score position', () => {
  const { tokens } = reviewPgn('1.e4 {[%crit opening]} (1.d4 {[%crit middlegame]} d5) e5 2.Nf3 {[%crit endgame]} Nc6 *');
  const path = san => tokens.find(token => token.san === san).path;
  assert.equal(criticalReveal(tokens, criticalRevealStage(tokens, '')).path, path('e4'));
  assert.equal(criticalReveal(tokens, criticalRevealStage(tokens, path('e4'))).path, path('d4'));
  assert.equal(criticalReveal(tokens, criticalRevealStage(tokens, path('d5'))).path, path('Nf3'));
  assert.equal(criticalReveal(tokens, criticalRevealStage(tokens, path('e5'))).path, path('Nf3'));
  assert.equal(criticalReveal(tokens, criticalRevealStage(tokens, path('Nf3'))).paused, false);
  assert.equal(criticalReveal(tokens, criticalRevealStage(tokens, path('Nc6'))).paused, false);
  assert.equal(criticalRevealStage(reviewPgn('1.d4 d5 *').tokens, ''), 0);
});

test('medals and critical positions share navigation and stops without duplicating mixed positions', () => {
  const { tokens } = reviewPgn('1.e4 {[%crit opening] [%medal tactics,attack]} (1.d4 {[%medal sacrifice]}) e5 {[%medal strategy]} 2.Nf3 Nc6 3.Ke5 {[%medal tactics]} *');
  assert.equal(criticalNavigation(tokens, '').total, 3);
  assert.deepEqual([0, 1, 2].map(stage => criticalReveal(tokens, stage).tokens.at(-1).san), ['e4', 'd4', 'e5']);
  assert.equal(criticalReveal(tokens, 3).paused, false);
  assert.equal(criticalRevealStage(tokens, tokens.find(t => t.san === 'd4').path), 2);
  assert.equal(criticalReveal(tokens).tokens.at(-1).medals.length, 2);
});
