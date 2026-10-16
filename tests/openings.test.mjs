import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue, classifyOpening, replayMainline } from '../electron/openings.mjs';

export const files = {
  a: 'eco\tname\tpgn\nA00\tStart\t1. a3\n',
  b: 'eco\tname\tpgn\nB00\tKing Pawn\t1. e4\n',
  c: 'eco\tname\tpgn\nC20\tOpen Game\t1. e4 e5\nC40\tOpen Game: Knight Line\t1. e4 e5 2. Nf3\nC44\tOpen Game: Knight Line, Two Knights\t1. e4 e5 2. Nf3 Nc6\n',
  d: 'eco\tname\tpgn\nD00\tQueen Pawn: Main Line, Setup\t1. d4 d5 2. Nf3 Nf6\n',
  e: 'eco\tname\tpgn\nE00\tAnother Family: Main Line\t1. d4 Nf6\n',
};

test('catalogue taxonomy scopes names and classification keeps every named match', () => {
  const catalogue = buildCatalogue(files);
  const result = classifyOpening('1.e4 { note } e5 (1... c5 (2. Nf3)) 2.Nf3!? Nc6 *', catalogue);
  assert.equal(result.status, 'matched'); assert.equal(result.matched_ply, 4);
  assert.equal(result.matches.length, 4);
  assert.equal(catalogue.entries.find(entry => entry.id === result.primary_entry_id).name, 'Open Game: Knight Line, Two Knights');
  const mains = catalogue.nodes.filter(node => node.label === 'Main Line');
  assert.equal(mains.length, 2); assert.notEqual(mains[0].id, mains[1].id);
  const overridden = buildCatalogue(files, { 'Open Game: Knight Line, Two Knights': ['Open Game', 'Knight Line, Two Knights'] });
  assert.ok(overridden.nodes.some(node => node.label === 'Knight Line, Two Knights'));
});

test('position classification supports transpositions and legal en passant normalization', () => {
  const result = classifyOpening('1. Nf3 Nf6 2. d4 d5 *', buildCatalogue(files));
  assert.equal(result.status, 'matched'); assert.equal(result.matched_ply, 4);
  assert.equal(result.matches[0].exact, false);
  assert.match(replayMainline('1. e4').positions[0], / -$/);
  assert.match(replayMainline('1. e4 a6 2. e5 d5').positions.at(-1), / d6$/);
});

test('same-position classification prefers canonical sequence before deeper aliases', () => {
  const copy = { ...files, d: files.d + 'D01\tOther Family: Deep, Alias, Name\t1. Nf3 Nf6 2. d4 d5\n' };
  const catalogue = buildCatalogue(copy);
  const result = classifyOpening('1.d4 d5 2.Nf3 Nf6', catalogue);
  assert.equal(catalogue.entries.find(entry => entry.id === result.primary_entry_id).eco, 'D00');
  assert.equal(result.matches.length, 2);
});

test('invalid, corrupt, truncated, unmatched and side-line-only records do not get authoritative matches', () => {
  const catalogue = buildCatalogue(files);
  for (const pgn of ['1. e4 e5 2. Bh6', '1. e4 {unfinished', '1. e4 (1. d4', '1. e4 garbage']) {
    const result = classifyOpening(pgn, catalogue);
    assert.equal(result.status, 'invalid', pgn); assert.equal(result.primary_entry_id, null); assert.deepEqual(result.matches, []);
  }
  assert.equal(classifyOpening('1. h3 (1. e4 e5)', catalogue).status, 'unmatched');
  assert.throws(() => buildCatalogue({ ...files, a: 'invalid' }), /columns/);
  assert.throws(() => buildCatalogue({ ...files, a: files.a + 'A01\tBroken\t1. Bh6\n' }), /Illegal/);
});
