import { writeFileSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { cpus, totalmem, platform, release } from 'node:os';
import { OpeningQueryService, STANDARD_OPENING_FEN } from '../lib/opening-query.mjs';
import { openingBoard } from '../src/opening-session.mjs';
import { fileHash } from '../lib/opening-library-storage.mjs';

const path = process.argv[2], output = process.argv[3];
if (!path || !output) throw new Error('Usage: run-archive-tool.mjs scripts/benchmark-opening-library.mjs READY_LIBRARY REPORT.json');
const before = fileHash(path), started = performance.now(), service = new OpeningQueryService(resolve(path));
const startupMs = performance.now() - started, c = service.catalog(), revision = c.revision;
const quantiles = values => { const sorted = [...values].sort((a,b) => a-b); return { samples: values.length, p50: sorted[Math.ceil(sorted.length * .5)-1], p95: sorted[Math.ceil(sorted.length * .95)-1], max: sorted.at(-1) }; };
const timed = fn => { const start = performance.now(), value = fn(); return { ms: performance.now() - start, value }; };
const sicilian = ['e2e4','c7c5','g1f3','d7d6','d2d4','c5d4','f3d4','g8f6','b1c3','a7a6'];
const cases = [
  ['root',{}], ['e4',{ moves: ['e2e4'] }], ['sicilian',{ moves: sicilian.slice(0,3) }],
  ['najdorf',{ moves: sicilian }], ['no-hit',{ rootFen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', moves: ['e2e4'] }],
  ['theory',{ moves: sicilian.slice(0,2), filters: { roles: ['theory'] } }],
  ['main-collection',{ moves: sicilian.slice(0,2), filters: { roles: ['main_games'] } }],
  ['comment-english',{ moves: sicilian.slice(0,2), filters: { annotationLanguages: ['en'] } }],
  ['metadata',{ moves: sicilian.slice(0,2), filters: { query: 'Najdorf' } }],
  ['root-anchor',{ mode: 'position', rootFen: STANDARD_OPENING_FEN, moves: [] }],
  ['root-anchor-sicilian-suffix',{ mode: 'position', rootFen: STANDARD_OPENING_FEN, moves: ['e2e4','c7c5'] }],
  ['transposition-anchor',{ mode: 'position', rootFen: openingBoard(STANDARD_OPENING_FEN, ['g1f3','d7d5','g2g3']).fen, moves: [] }],
];
const results = [], memory = [];
try {
  const repeated = service.db.prepare(`SELECT p.exact_key FROM study_documents d
    JOIN study_nodes a ON a.document_id=d.id
    JOIN study_nodes b ON b.position_id=a.position_id AND b.document_id=d.id
    JOIN positions p ON p.id=a.position_id
    WHERE d.id IN (SELECT id FROM study_documents ORDER BY id LIMIT 512) AND b.ply>a.ply
      AND (a.source_path='' OR substr(b.source_path,1,length(a.source_path)+1)=a.source_path||'.') LIMIT 1`).get();
  if (!repeated) throw new Error('No actual ancestor/repeated-position sample found in the first 512 documents');
  cases.push(['actual-repeated-position', { mode: 'position', rootFen: repeated.exact_key + ' 0 1', moves: [] }]);
  const initial = timed(() => service.explore({ revision }));
  const articlePage = service.materials({ revision, token: initial.value.token, kind: 'articles' });
  const sicilianArticleContext = service.explore({ revision, moves: sicilian.slice(0,2) });
  const sicilianArticles = service.materials({ revision, token: sicilianArticleContext.token, kind: 'articles' });
  if (sicilianArticles.items[0]) cases.push(['article-filter', { moves: sicilian.slice(0,2), filters: { articleKeys: [sicilianArticles.items[0].key] } }]);
  for (const [name, request] of cases) {
    const freshOpen = [], freshQuery = [];
    for (let i = 0; i < 5; i++) {
      const opened = timed(() => new OpeningQueryService(resolve(path))), fresh = opened.value;
      try { freshOpen.push(opened.ms); freshQuery.push(timed(() => fresh.explore({ revision, ...request })).ms); }
      finally { fresh.close(); }
    }
    const misses = [], hits = [], material = [], articlePages = [], articles = [], studies = [];
    let result;
    for (let i = 0; i < 10; i++) {
      service.cache.clear(); service.tokens.clear(); service.weight = 0;
      const measured = timed(() => service.explore({ revision, ...request })); result = measured.value; misses.push(measured.ms);
      hits.push(timed(() => service.explore({ revision, ...request })).ms);
      const games = timed(() => service.materials({ revision, token: result.token, kind: 'games' })); material.push(games.ms);
      if (games.value.items[0]) { const game = games.value.items[0]; studies.push(timed(() => service.study({ revision, key: game.key, treeHash: game.treeHash, sourcePath: game.match.sourcePath, token: result.token })).ms); }
      const measuredPage = timed(() => service.materials({ revision, token: result.token, kind: 'articles' })); articlePages.push(measuredPage.ms);
      const page = measuredPage.value;
      if (page.items[0]) articles.push(timed(() => service.article({ revision, key: page.items[0].key, language: 'en' })).ms);
    }
    results.push({ name, freshConnectionOpenMs: quantiles(freshOpen), freshConnectionQueryMs: quantiles(freshQuery), warmContextMissMs: quantiles(misses), contextHitMs: quantiles(hits), gamePageMs: quantiles(material), articlePageMs: quantiles(articlePages), firstStudyMs: studies.length ? quantiles(studies) : null, firstArticleMs: articles.length ? quantiles(articles) : null,
      counts: { games: result.gameRecordCount, lines: result.sourceLineCount, articles: result.relatedArticleCount } });
    memory.push({ name, ...process.memoryUsage() });
    console.log(JSON.stringify(results.at(-1)));
  }
  const plans = {};
  for (const [name, sql] of Object.entries({ prefix: 'SELECT id FROM study_nodes WHERE prefix_id=1', position: 'SELECT id FROM study_nodes WHERE position_id=1', child: 'SELECT id FROM study_nodes WHERE parent_id=1', relation: 'SELECT article_id FROM article_document_relations WHERE document_id=1' })) plans[name] = service.db.prepare('EXPLAIN QUERY PLAN ' + sql).all();
  service.close();
  const after = fileHash(path); if (before !== after) throw new Error('Runtime file changed during benchmark');
  writeFileSync(output, JSON.stringify({ createdAt: new Date().toISOString(), libraryUUID: c.libraryUUID, revision, checksum: before, bytes: statSync(path).size,
    environment: { cpu: cpus()[0]?.model, logicalCPUs: cpus().length, memoryBytes: totalmem(), platform: platform(), release: release(), electron: process.versions.electron },
    methodology: 'First-open sample is process-cold with uncontrolled OS cache. Five fresh connections per case reopen the readonly service with empty SQLite/application caches, reporting open and first-query times separately. Ten warm context misses per case clear only application cursor caches; SQLite/OS pages and the bounded root-equivalence proof cache remain warm. Hits immediately repeat the same route. Full-file hashing also warms OS file pages. No physical-disk-cold, OS cache purge or machine reboot is claimed.',
    startupMs, firstRootMs: initial.ms, results, memory, plans }, null, 2));
  console.log('Unchanged-library report written:', output);
} catch (error) { try { service.close(); } catch {} throw error; }
