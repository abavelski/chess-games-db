import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePgn, startingPosition } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { treeFixtures } from './fixtures/opening-study.mjs';
import { readSourceTree, normalizeAnnotations, generateViewerPgn } from '../lib/opening-source-tree.mjs';

for (const fixture of treeFixtures) test(`strict source DTO: ${fixture.key}`, () => {
  if (fixture.invalid) return assert.throws(() => readSourceTree(fixture));
  const tree = readSourceTree(fixture);
  assert.equal(tree.moveCount, fixture.all_lines_ply);
  if (fixture.expected) assert.deepEqual(tree.nodes.slice(1).map(n => ({
    san: n.san, path: n.path.join('.'), sourceIndex: n.sourceIndex,
  })), fixture.expected);
  const leaves = [];
  const walk = (node, moves) => {
    if (!node.children.length) leaves.push(moves);
    for (const child of node.children) walk(child, [...moves, child.uci]);
  };
  walk(tree.root, []);
  if (fixture.leaves) assert.deepEqual(leaves, fixture.leaves);
  for (const node of tree.nodes) {
    const descendantLeaves = leaves.filter(path => {
      const prefix = [];
      for (let cursor = node; cursor.parent; cursor = cursor.parent) prefix.unshift(cursor.uci);
      return prefix.every((move, i) => path[i] === move);
    });
    // Same-move siblings need ordinal provenance; compare root and unique paths.
    if (fixture.key !== 'duplicate-siblings') assert.equal(node.leafHi - node.leafLo, descendantLeaves.length);
  }
  const annotations = normalizeAnnotations(tree, fixture.annotations ?? []);
  const pgn = generateViewerPgn(tree, annotations);
  const [game] = parsePgn(pgn);
  const roundtripLeaves = [];
  const roundtripAnnotations = [];
  const comments = list => {
    for (const comment of list ?? []) {
      const match = /^\[%opening ([A-Za-z0-9+/=]+)\]$/.exec(comment);
      assert.ok(match, 'all generated comments are recognized');
      roundtripAnnotations.push(JSON.parse(Buffer.from(match[1], 'base64')));
    }
  };
  comments(game.comments);
  const replay = (node, position, path) => {
    if (!node.children.length) roundtripLeaves.push(path);
    for (const child of node.children) {
      comments(child.data.startingComments);
      comments(child.data.comments);
      const move = parseSan(position, child.data.san);
      assert.ok(move && position.isLegal(move));
      const next = position.clone(); next.play(move);
      replay(child, next, [...path, makeUci(move)]);
    }
  };
  replay(game.moves, startingPosition(game.headers).unwrap(), []);
  assert.deepEqual(roundtripLeaves, leaves);
  assert.deepEqual(roundtripAnnotations.sort((a, b) => a.sequence - b.sequence), annotations);
});

test('annotation attachment and unsupported dispositions remain explicit', () => {
  const fixture = treeFixtures[0];
  const tree = readSourceTree(fixture);
  const annotations = normalizeAnnotations(tree, fixture.annotations);
  assert.equal(annotations[0].placement, 'root');
  assert.equal(annotations[1].placement, 'before');
  assert.equal(annotations[1].sourcePath, '0.1');
  assert.equal(annotations[7].status, 'unsupported');
  assert.equal(annotations[8].status, 'unsupported');
  assert.equal(annotations[9].payload.text, fixture.annotations[9].text);
  const bad = { ...fixture.annotations[1], move_index: 1000 };
  assert.equal(normalizeAnnotations(tree, [bad])[0].status, 'unmapped');
});

test('node mismatch cannot be marked complete; empty trees have no searchable lines', () => {
  assert.throws(() => readSourceTree({ ...treeFixtures[0], all_lines_ply: 1 }), /count mismatch/);
  assert.equal(readSourceTree({ ...treeFixtures[0], moves_pgn: '', all_lines_ply: 0 }).leafCount, 0);
});

test('incomplete numbering and incorrect setup move counters are rejected', () => {
  for (const moves_pgn of ['1. e4 1...', '1. e4 1... *', '1. 1. e4', '42. e4', '1. e4 e5 (1... )'])
    assert.throws(() => readSourceTree({ ...treeFixtures[0], moves_pgn, all_lines_ply: null }));
  assert.throws(() => readSourceTree({ ...treeFixtures[0], main_line_ply: 99 }), /mainline count mismatch/);
});
