import test from 'node:test';
import assert from 'node:assert/strict';
import { completeness, extractFeatures, legacyGameKey, retention, resultCode, searchKey } from '../lib/game-policy.mjs';
test('retention and completeness require evidence, never infer from result or setup', () => {
  assert.equal(retention({ record_kind: 'game', is_training: 1, start_fen: 'setup' }).retain, true);
  for (const record_kind of ['text','line','position']) assert.equal(retention({record_kind}).retain, false);
  assert.equal(completeness({ result: '1-0' }).value, 'unknown');
  assert.equal(completeness({ result: '*' }).value, 'unknown');
  assert.equal(completeness({ completeness: { value: 'partial', evidence: 'source flag' } }).value, 'partial');
  assert.equal(resultCode('unusual'), 'unknown');
  assert.notEqual(legacyGameKey('a:b','c'), legacyGameKey('a','b:c'));
  assert.equal(searchKey('ÉCOLE'), searchKey('E\u0301cole'));
});
test('annotation facts include comments without credits, variations, and distinct editions', () => {
  assert.equal(extractFeatures('[Annotator "Doe, Jane; Team"]\n\n1. e4 *').annotated, 0);
  assert.equal(extractFeatures('1. e4 {comment} *').comments, 1);
  assert.equal(extractFeatures('1. e4 (1. d4) *').variations, 1);
  assert.equal(extractFeatures('1. e4 $1 *').nags, 1);
  assert.equal(extractFeatures('1. e4 {other edition} *').annotated, 1);
  assert.equal(extractFeatures('[FEN "bad"]\n\n1. e4 *').status, 'error');
});
