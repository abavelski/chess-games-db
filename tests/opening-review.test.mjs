import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePgn, startingPosition } from 'chessops/pgn';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { readSourceTree, normalizeAnnotations } from '../lib/opening-source-tree.mjs';
import { treeFixtures } from './fixtures/opening-study.mjs';
import { openingReviewGame, sourceReviewPath, reviewSourcePath } from '../src/opening-review.mjs';
import { reviewPgn, extendReviewLine } from '../src/pgn.mjs';
function study(fixture) {
  const tree = readSourceTree(fixture);
  const ids = new Map(tree.nodes.map((n, i) => [n, i]));
  return { startFen: fixture.start_fen, nodes: tree.nodes.map(n => ({
    id: ids.get(n), parentId: n.parent ? ids.get(n.parent) : null, ordinal: n.ordinal,
    sourcePath: n.path.join('.'), san: n.san,
  })), annotations: normalizeAnnotations(tree, fixture.annotations || []).map(a => ({
    ...a, nodeId: tree.nodes.findIndex(n => n.path.join('.') === a.sourcePath),
  })) };
}
test('opening adapter preserves nested branches, comments, drawings, NAGs and labelled languages', () => {
  const value = study(treeFixtures[0]);
  const game = openingReviewGame(value);
  const tokens = reviewPgn(game.pgn, true).tokens;
  const comments = tokens.filter(t => t.type === 'comment').map(t => t.text);
  assert.ok(comments.includes('Synthetic root explanation.'));
  assert.ok(comments.some(t => t.includes('Unsupported source annotation: Evaluations')));
  assert.ok(comments.some(t => t.includes('Unsupported source annotation: FutureType')));
  assert.ok(!comments.some(t => t.includes('Der c-Bauer')));
  const before = tokens.findIndex(t => t.text === 'Prepare a different pawn structure.');
  const move = tokens.findIndex(t => t.path === sourceReviewPath('0.1'));
  const after = tokens.findIndex(t => t.text === 'The c-pawn supports d5.');
  assert.ok(before < move && move < after);
  const d4 = tokens.find(t => t.path === sourceReviewPath('0.1.0'));
  assert.deepEqual(d4.nags, [1, 14]); assert.equal(d4.annotated, true);
  assert.ok(game.pgn.includes('[%cal Gd2d4]')); assert.ok(game.pgn.includes('[%csl Rd4]'));
});
test('duplicate sibling identities survive export and temporary analysis extends the selected sibling', () => {
  const game = openingReviewGame(study(treeFixtures[1]));
  const tokens = reviewPgn(game.pgn, true).tokens.filter(t => t.type === 'move');
  assert.equal(new Set(tokens.map(t => t.path)).size, tokens.length);
  assert.equal(tokens.find(t => t.path === sourceReviewPath('0.1.0')).san, 'Nc3');
  const extended = extendReviewLine(game.pgn, sourceReviewPath('0.1'), ['e2e4', 'e7e5', 'd2d4']);
  assert.equal(reviewSourcePath(extended.path), '0.1.1');
  assert.equal(reviewPgn(extended.pgn, true).tokens.find(t => t.path === sourceReviewPath('0.0.0')).san, 'Nf3');
  for (const path of ['', '0', '0.1', '0.1.0']) assert.equal(reviewSourcePath(sourceReviewPath(path)), path);
});
test('custom source FEN counters survive shared PGN replay', () => {
  const fixture = treeFixtures[2], game = parsePgn(openingReviewGame(study(fixture)).pgn)[0];
  const position = startingPosition(game.headers).unwrap();
  assert.equal(makeFen(position.toSetup()), fixture.start_fen);
  position.play(parseSan(position, game.moves.children[0].data.san));
  assert.ok(makeFen(position.toSetup()).endsWith('w - - 18 43'));
});

test('source prose is literal and cannot inject PGN evaluations, drawings or moves', () => {
  const value = study(treeFixtures[0]), text = 'Unicode \u265e {braces} [%eval 999] [%cal Ra1a8]';
  value.annotations = [{ nodeId: 1, sequence: 0, placement: 'after', language: 'en', sourceLanguage: 'ENG', status: 'supported', payload: { text } }];
  const model = reviewPgn(openingReviewGame(value).pgn, true);
  assert.ok(model.tokens.some(t => t.text === text));
  assert.ok(!model.tokens.some(t => t.evaluations?.length || t.annotated));
  assert.ok(!model.displayPgn.includes('[%cal'));
});

test('review comments prefer English, then Russian, then other available text per attachment', () => {
  const value = study(treeFixtures[0]);
  const comment = (sequence, language, text, placement = 'after') => ({ nodeId: 1, sequence, language, sourceLanguage: language, placement, status: 'supported', payload: { text } });
  value.annotations = [comment(0, 'de', 'German'), comment(1, 'ru', 'Russian'), comment(2, 'en', 'English one'), comment(3, 'en', 'English two'), comment(4, 'ru', 'Before Russian', 'before')];
  const texts = () => reviewPgn(openingReviewGame(value).pgn, true).tokens.filter(t => t.type === 'comment').map(t => t.text);
  assert.deepEqual(texts(), ['[ru] Before Russian', 'English one', 'English two']);
  value.annotations = value.annotations.filter(a => a.language !== 'en');
  value.annotations.push(comment(5, 'en', '   '));
  assert.deepEqual(texts(), ['[ru] Before Russian', '[ru] Russian']);
  value.annotations = value.annotations.filter(a => a.language !== 'ru');
  assert.deepEqual(texts(), ['[de] German']);
});
