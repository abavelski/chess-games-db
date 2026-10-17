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
