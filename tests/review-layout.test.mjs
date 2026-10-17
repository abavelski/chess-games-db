import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewPgn } from '../src/pgn.mjs';
import { reviewLayout } from '../src/review-layout.mjs';

test('mainline rows pair White and Black with a numbered gutter', () => {
  const rows = reviewLayout(reviewPgn('1.e4 e5 2.Nf3 Nc6 *').tokens);
  assert.deepEqual(rows.map(row => [row.number, row.white.token.san, row.black.token.san]), [[1, 'e4', 'e5'], [2, 'Nf3', 'Nc6']]);
});
test('comments interrupt rows and variations preserve source order and nesting', () => {
  const model = reviewPgn('{Intro} 1.e4 {Center} (1.d4 d5 (1...Nf6 {Nested})) e5 2.Nf3 Nc6 *');
  const layout = reviewLayout(model.tokens);
  assert.equal(layout[0].token.text, 'Intro');
  assert.equal(layout[1].white.token.san, 'e4');
  assert.equal(layout[1].black, null);
  assert.equal(layout[2].token.text, 'Center');
  assert.equal(layout[3].type, 'variation');
  assert.equal(layout[3].items[2].type, 'variation');
  assert.equal(layout[3].items[2].items[1].token.text, 'Nested');
  assert.equal(layout[4].white, null);
  assert.equal(layout[4].black.token.san, 'e5');
  assert.equal(layout[5].white.token.san, 'Nf3');
  assert.equal(layout[5].black.token.san, 'Nc6');
});
test('Black-to-move setups and illegal source moves keep their columns and text', () => {
  const setup = reviewLayout(reviewPgn('[SetUp "1"]\n[FEN "8/8/8/8/8/8/4K3/7k b - - 0 24"]\n\n24...Kh2 *').tokens);
  assert.equal(setup[0].number, 24);
  assert.equal(setup[0].white, null);
  assert.equal(setup[0].black.token.san, 'Kh2');
  const illegal = reviewLayout(reviewPgn('1.e4 e5 2.Ke5 {Still readable} Nc6 *').tokens);
  assert.equal(illegal[1].white.token.path, null);
  assert.equal(illegal[2].token.text, 'Still readable');
  assert.equal(illegal[3].black.token.path, null);
});
