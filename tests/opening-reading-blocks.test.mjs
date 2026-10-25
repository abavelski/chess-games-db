import test from 'node:test';
import assert from 'node:assert/strict';
import { articleFixtures, standardFen } from './fixtures/opening-study.mjs';
import { readingBlocks, normalizeLanguage } from '../lib/opening-article-converter.mjs';

test('navigation-only languages do not masquerade as translated prose', () => {
  const versions = articleFixtures[0].versions;
  const results = readingBlocks(versions.map(v => v.html));
  assert.deepEqual(results.map(r => r.meaningful), versions.map(v => v.meaningful));
  assert.equal(results[0].plain_text, '');
  assert.equal(normalizeLanguage('ENG'), normalizeLanguage('ENGLISH'));
});

test('hostile malformed markup becomes inert typed text without active attributes or resources', () => {
  const [result] = readingBlocks([articleFixtures[2].html]);
  const encoded = JSON.stringify(result.blocks);
  assert.match(result.plain_text, /Safe words/);
  assert.match(result.plain_text, /retained/);
  assert.doesNotMatch(encoded, /javascript:|file:\/\/|https:\/\/|data:text|onclick|onload|onerror|alert\(/i);
  const keys = new Set(['type','children','text','anchor','level','ordered','fen']);
  const visit = blocks => blocks.forEach(b => {
    for (const key of Object.keys(b)) assert.ok(keys.has(key), `No source attribute may become a rendering prop: ${key}`);
    if (b.children) visit(b.children);
  });
  visit(result.blocks);
});

test('diagrams are legal local FENs; missing media and invalid FENs remain visible', () => {
  const [result] = readingBlocks([articleFixtures[3].html]);
  assert.ok(result.blocks.some(b => b.type === 'diagram' && b.fen === standardFen));
  assert.equal(result.blocks.filter(b => b.type === 'unavailable').length, 2);
});

test('damaged labels are retained and unclosed navigation uses a safe whole-body fallback', () => {
  const [damaged, fallback] = readingBlocks([articleFixtures[4].html,
    '<div class="SideBar"><a href="javascript:anything">Menu</a><p>Original explanatory text following an unclosed navigation container. This must remain readable through the safe fallback and must never execute as source HTML.</p>']);
  assert.match(damaged.plain_text, /King\uFFFDs plan/);
  assert.equal(fallback.fallback, true);
  assert.match(fallback.plain_text, /must remain readable/);
});
