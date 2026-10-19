import test from 'node:test';
import assert from 'node:assert/strict';
import { nagDescription, nagDescriptions, nonStandardNagGlyphs } from '../src/nag-descriptions.mjs';

test('all specified NAGs have descriptions, with distinct White and Black meanings', () => {
  assert.equal(nagDescriptions.length, 140);
  for (let nag = 0; nag <= 139; nag++) assert.ok(nagDescription(nag)?.trim(), `Missing NAG ${nag}`);
  for (let nag = 14; nag < 140; nag += 2) {
    assert.match(nagDescription(nag), /^White /);
    assert.equal(nagDescription(nag + 1), nagDescription(nag).replace(/^White /, 'Black '));
  }
  assert.equal(nagDescription(5), 'Speculative move');
  assert.equal(nagDescription(8), 'Singular move; no reasonable alternative');
  assert.equal(nagDescription(84), 'White has a very strong pawn structure');
  assert.equal(nagDescription(86), 'White has poor knight placement');
  assert.equal(nagDescription(94), 'White has poor rook placement');
  assert.equal(nagDescription(97), 'Black has good rook placement');
  assert.equal(nagDescription(139), 'Black is under severe time pressure');
  assert.equal(nagDescription(200), undefined);
});

test('non-standard conventions supply descriptions and available symbols without filling undefined ranges', () => {
  const codes = [140, 141, 142, 143, 144, 145, 146, 147, 148, 220, 221,
    ...Array.from({ length: 18 }, (_, i) => 238 + i)];
  assert.deepEqual(Object.keys(nonStandardNagGlyphs).map(Number), codes);
  for (const nag of codes) assert.ok(nagDescription(nag)?.trim(), `Missing non-standard NAG ${nag}`);
  assert.equal(nonStandardNagGlyphs[142].symbol, '⌓');
  assert.equal(nagDescription(142), 'Better is…');
  assert.equal(nonStandardNagGlyphs[221].symbol, '⬓');
  assert.equal(nagDescription(221), 'Diagram from Black’s perspective');
  assert.equal(nonStandardNagGlyphs[246].symbol, '');
  assert.equal(nagDescription(246), 'Bishop pair');
  assert.equal(nagDescription(255), 'Without');
  for (const nag of [149, 200, 219, 222, 237, 256]) assert.equal(nagDescription(nag), undefined);
});
