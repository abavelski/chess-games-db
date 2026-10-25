import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { normalizeMove } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseUci, makeUci } from 'chessops/util';
import { makeSan } from 'chessops/san';
import { parseSearchPosition, positionFingerprint } from './position-hash.mjs';
import { openOpeningLibrary } from './opening-library-storage.mjs';
import { normalizeLanguage } from './opening-language.mjs';
import { digest } from './opening-source-tree.mjs';

export const STANDARD_OPENING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export class OpeningQueryError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const invalid = message => { throw new OpeningQueryError('INVALID_REQUEST', message); };
const LIMIT = 250_000;
const selectNode = `n.id,n.document_id,n.source_path,n.ply,n.is_mainline,n.move_uci,n.san,n.leaf_lo,n.leaf_hi,
  NOT EXISTS(SELECT 1 FROM study_nodes child WHERE child.parent_id=n.id) terminal`;
const textTypes = "('TextBefore','TextAfter')";
const boundedString = (value, max, label) => {
  if (typeof value !== 'string' || value.length > max) invalid(`Invalid ${label}`);
  return value;
};
const plain = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected a request object');
  return value;
};
const only = (value, names) => { if (Object.keys(value).some(k => !names.includes(k))) invalid('Unknown request field'); };
const positive = (n, max, fallback) => {
  if (n === undefined) return fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) invalid('Invalid page bound');
  return n;
};
const numericPathOrder = (a, b) => {
  const aa = a.source_path ? a.source_path.split('.').map(Number) : [];
  const bb = b.source_path ? b.source_path.split('.').map(Number) : [];
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return aa.length - bb.length;
};
export function intervalUnionCount(rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.document_id) ?? [];
    group.push([row.leaf_lo, row.leaf_hi]); groups.set(row.document_id, group);
  }
  let count = 0;
  for (const intervals of groups.values()) {
    intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let lo = -1, hi = -1;
    for (const [a, b] of intervals) {
      if (a > hi) { if (lo >= 0) count += hi - lo; lo = a; hi = b; }
      else hi = Math.max(hi, b);
    }
    if (lo >= 0) count += hi - lo;
  }
  return count;
}

export class OpeningQueryService {
  constructor(path) {
    this.path = path;
    const opened = openOpeningLibrary(path);
    this.db = opened.db; this.manifest = opened.manifest;
    this.db.pragma('cache_size=-65536');
    this.coverage = { ...this.manifest.coverage,
      deletedRecords: this.db.prepare("SELECT count(*) n FROM source_items WHERE validation_status='deleted'").get().n,
      partialAnnotationDocuments: this.db.prepare("SELECT count(*) n FROM study_documents WHERE annotation_coverage='partial'").get().n };
    const stat = statSync(path); this.fileIdentity = [stat.dev, stat.ino, stat.size, stat.mtimeMs].join(':');
    this.cache = new Map(); this.tokens = new Map(); this.weight = 0;
    this.relations = new Map();
    for (const r of this.db.prepare('SELECT DISTINCT document_id,article_id FROM article_document_relations').iterate()) {
      const values = this.relations.get(r.document_id) ?? [];
      values.push(r.article_id); this.relations.set(r.document_id, values);
    }
    for (const method of ['articleCatalog','article','study']) this[method] = this.db.transaction(this[method].bind(this));
  }
  close() { this.cache.clear(); this.tokens.clear(); this.db.close(); }
  assertCurrent(revision) {
    const stat = statSync(this.path);
    if ([stat.dev, stat.ino, stat.size, stat.mtimeMs].join(':') !== this.fileIdentity)
      throw new OpeningQueryError('LIBRARY_CHANGED', 'Library file changed; reopen it before continuing');
    if (revision !== this.manifest.revision) throw new OpeningQueryError('EXPIRED_CONTEXT', 'Library revision changed; start a new exploration');
  }
  catalog() {
    const m = this.manifest;
    return { format: m.format, libraryUUID: m.library_uuid, revision: m.revision, corpus: m.corpus,
      capabilities: m.capabilities, coverage: this.coverage };
  }
  filters(value = {}) {
    plain(value); only(value, ['roles','articleKeys','query','annotationLanguages']);
    const array = (v, max, check) => {
      if (v === undefined) return [];
      if (!Array.isArray(v) || v.length > max || v.some(x => typeof x !== 'string' || !check(x))) invalid('Invalid filter values');
      return [...new Set(v)].sort();
    };
    return { roles: array(value.roles, 2, x => ['main_games','theory'].includes(x)),
      articleKeys: array(value.articleKeys, 32, x => x.length > 0 && x.length <= 512),
      query: boundedString(value.query ?? '', 256, 'metadata query').normalize('NFKC').toLowerCase().trim(),
      annotationLanguages: array(value.annotationLanguages, 16, x => /^[a-z]{2,3}$/.test(x)).map(normalizeLanguage).sort() };
  }
  predicate(filters) {
    const where = [], params = [];
    let joins = '';
    if (filters.roles.length || filters.query) joins = ' JOIN study_documents d ON d.id=n.document_id';
    if (filters.roles.length) {
      joins += ' JOIN source_items s ON s.id=d.item_id JOIN source_collections c ON c.id=s.collection_id';
      where.push('c.role IN (SELECT value FROM json_each(?))'); params.push(JSON.stringify(filters.roles));
    }
    if (filters.articleKeys.length) {
      where.push(`EXISTS(SELECT 1 FROM article_document_relations r JOIN articles a ON a.id=r.article_id
        JOIN source_items item ON item.id=a.item_id WHERE r.document_id=n.document_id AND item.stable_key IN (SELECT value FROM json_each(?)))`);
      params.push(JSON.stringify(filters.articleKeys));
    }
    if (filters.query) {
      where.push(`(instr(d.search_text,?)>0 OR EXISTS(SELECT 1 FROM article_document_relations r JOIN articles a ON a.id=r.article_id
        WHERE r.document_id=n.document_id AND instr(a.search_title,?)>0))`);
      params.push(filters.query, filters.query);
    }
    if (filters.annotationLanguages.length) {
      where.push(`EXISTS(SELECT 1 FROM node_annotations a WHERE a.document_id=n.document_id AND a.source_type IN ${textTypes}
        AND ((a.language IN (SELECT value FROM json_each(?))) OR (a.language IS NULL AND ?))
        AND length(trim(json_extract(a.payload_json,'$.text')))>0)`);
      params.push(JSON.stringify(filters.annotationLanguages), Number(filters.annotationLanguages.includes('und')));
    }
    return { joins, sql: where.length ? ' AND ' + where.join(' AND ') : '', params };
  }
  rows(sql, params) {
    const rows = this.db.prepare(sql + ` LIMIT ${LIMIT + 1}`).all(...params);
    if (rows.length > LIMIT) throw new OpeningQueryError('LIMIT_EXCEEDED', 'Exploration has too many source cursors; narrow the filters');
    return rows;
  }
  counters(nodes) {
    const documents = new Set(nodes.map(n => n.document_id)), articles = new Set();
    for (const id of documents) for (const article of this.relations.get(id) ?? []) articles.add(article);
    return { gameRecordCount: documents.size, sourceLineCount: intervalUnionCount(nodes), relatedArticleCount: articles.size,
      endingLineCount: intervalUnionCount(nodes.filter(n => n.terminal)) };
  }
  explore(request) {
    plain(request); only(request, ['revision','requestId','mode','rootFen','moves','filters']);
    this.assertCurrent(request.revision);
    if (request.requestId !== undefined && (!Number.isSafeInteger(request.requestId) || request.requestId < 0)) invalid('Invalid request revision');
    const mode = request.mode ?? 'prefix';
    if (!['prefix','position'].includes(mode)) invalid('Invalid exploration mode');
    const rootFen = boundedString(request.rootFen ?? STANDARD_OPENING_FEN, 256, 'root FEN');
    const position = parseSearchPosition(rootFen), root = positionFingerprint(position);
    if (!Number.isSafeInteger(position.fullmoves) || !Number.isSafeInteger(position.halfmoves)) invalid('Invalid FEN counters');
    if (!Array.isArray(request.moves ?? []) || (request.moves ?? []).length > 2048) invalid('Move path exceeds limit');
    const moves = [], sans = [];
    for (const uci of request.moves ?? []) {
      if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) invalid('Invalid UCI move');
      const parsed = parseUci(uci);
      if (!parsed || !position.isLegal(parsed)) invalid('Illegal exploration move');
      const move = normalizeMove(position, parsed);
      moves.push(makeUci(move)); sans.push(makeSan(position, move)); position.play(move);
    }
    const filters = this.filters(request.filters);
    const key = digest(JSON.stringify([this.manifest.library_uuid, this.manifest.revision, mode, rootFen, moves, filters]));
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return { ...cached.response, requestId: request.requestId ?? 0 }; }
    const result = this.db.transaction(() => {
      const posRow = this.db.prepare('SELECT id FROM positions WHERE hash=? AND exact_key=?').get(root.sqliteHash, root.verificationKey);
      const predicate = this.predicate(filters);
      let nodes = [];
      if (posRow) {
        if (mode === 'prefix') {
          let prefix = this.db.prepare(`SELECT p.id FROM move_prefixes p JOIN prefix_roots r ON r.id=p.root_id
            WHERE p.parent_id IS NULL AND r.position_id=?`).get(posRow.id);
          for (const move of moves) prefix = prefix ? this.db.prepare('SELECT id FROM move_prefixes WHERE parent_id=? AND move_uci=?').get(prefix.id, move) : null;
          if (prefix) nodes = this.rows(`SELECT ${selectNode} FROM study_nodes n${predicate.joins} WHERE n.prefix_id=?${predicate.sql}`, [prefix.id, ...predicate.params]);
        } else {
          nodes = this.rows(`SELECT ${selectNode} FROM study_nodes n${predicate.joins} WHERE n.position_id=?${predicate.sql}`, [posRow.id, ...predicate.params]);
          for (const move of moves) nodes = nodes.length ? this.rows(`SELECT ${selectNode} FROM study_nodes n
            JOIN json_each(?) cursors ON n.parent_id=cursors.value WHERE n.move_uci=?`, [JSON.stringify(nodes.map(n => n.id)), move]) : [];
        }
      }
      const children = nodes.length ? this.rows(`SELECT ${selectNode} FROM study_nodes n JOIN json_each(?) cursors ON n.parent_id=cursors.value`, [JSON.stringify(nodes.map(n => n.id))]) : [];
      const groups = new Map();
      for (const child of children) { const group = groups.get(child.move_uci) ?? []; group.push(child); groups.set(child.move_uci, group); }
      const continuations = [...groups].map(([uci, group]) => ({ uci, san: group[0].san, ...this.counters(group) }))
        .sort((a, b) => b.sourceLineCount - a.sourceLineCount || a.uci.localeCompare(b.uci));
      const token = randomUUID();
      return { key, token, nodes, children, filters, weight: nodes.length + children.length,
        response: { token, mode, rootFen, moves, sans, fen: makeFen({ ...position.toSetup(), epSquare: position.epSquare }),
          ...this.counters(nodes), continuations, coverage: this.coverage, libraryUUID: this.manifest.library_uuid,
          revision: this.manifest.revision, exhausted: nodes.length > 0 && children.length === 0,
          emptyLibrary: this.manifest.coverage.searchableDocuments === 0 } };
    })();
    while (this.cache.size && (this.cache.size >= 8 || this.weight + result.weight > 500_000)) {
      const [oldKey, old] = this.cache.entries().next().value;
      this.cache.delete(oldKey); this.tokens.delete(old.token); this.weight -= old.weight;
    }
    this.cache.set(key, result); this.tokens.set(result.token, result); this.weight += result.weight;
    return { ...result.response, requestId: request.requestId ?? 0 };
  }
  context(request) {
    this.assertCurrent(request.revision);
    const token = boundedString(request.token, 64, 'context cursor'), context = this.tokens.get(token);
    if (!context) throw new OpeningQueryError('EXPIRED_CONTEXT', 'Exploration cursor expired; repeat the exploration');
    return context;
  }
  materials(request) {
    plain(request); only(request, ['revision','token','kind','page','pageSize','language']);
    const context = this.context(request), kind = request.kind ?? 'games';
    if (!['games','articles','comments'].includes(kind)) invalid('Invalid material kind');
    const page = positive(request.page, 1_000_000, 1), pageSize = positive(request.pageSize, 50, 20);
    const documentIds = [...new Set(context.nodes.map(n => n.document_id))];
    const offset = (page - 1) * pageSize;
    return this.db.transaction(() => {
      if (kind === 'games') {
        const sorted = documentIds.sort((a, b) => a - b), selected = sorted.slice(offset, offset + pageSize);
        const rows = selected.length ? this.db.prepare(`SELECT d.*,s.stable_key,c.role,c.original_path FROM study_documents d
          JOIN source_items s ON s.id=d.item_id JOIN source_collections c ON c.id=s.collection_id WHERE d.id IN (SELECT value FROM json_each(?)) ORDER BY d.id`).all(JSON.stringify(selected)) : [];
        return { kind, page, pageSize, total: sorted.length, items: rows.map(d => {
          const matches = context.nodes.filter(n => n.document_id === d.id).sort((a, b) => b.is_mainline - a.is_mainline || a.ply - b.ply || numericPathOrder(a, b));
          return { key: d.stable_key, white: d.white, black: d.black, event: d.event, date: d.played_date, eco: d.eco,
            annotator: d.annotator, role: d.role, source: d.original_path, annotationCoverage: d.annotation_coverage,
            treeHash: d.tree_hash, match: { sourcePath: matches[0].source_path, ply: matches[0].ply }, matchCount: matches.length,
            matches: matches.slice(0, 50).map(n => ({ sourcePath: n.source_path, ply: n.ply })) };
        }) };
      }
      if (kind === 'articles') {
        const ids = [...new Set(documentIds.flatMap(id => this.relations.get(id) ?? []))].sort((a, b) => a - b);
        const items = ids.slice(offset, offset + pageSize).map(id => {
          const a = this.db.prepare('SELECT a.title,s.stable_key,c.original_path FROM articles a JOIN source_items s ON s.id=a.item_id JOIN source_collections c ON c.id=s.collection_id WHERE a.id=?').get(id);
          const evidence = this.db.prepare(`SELECT DISTINCT evidence_kind FROM article_document_relations WHERE article_id=? AND document_id IN (SELECT value FROM json_each(?))`).all(id, JSON.stringify(documentIds));
          return { key: a.stable_key, title: a.title, source: a.original_path, evidence: evidence.map(e => e.evidence_kind) };
        });
        return { kind, page, pageSize, total: ids.length, items };
      }
      const language = normalizeLanguage(boundedString(request.language ?? 'en', 16, 'reading language'));
      const base = `FROM node_annotations a JOIN json_each(?) cursor ON cursor.value=a.node_id
        JOIN study_nodes n ON n.id=a.node_id JOIN study_documents d ON d.id=a.document_id JOIN source_items s ON s.id=d.item_id
        WHERE a.source_type IN ${textTypes} AND length(trim(json_extract(a.payload_json,'$.text')))>0
        AND a.language IS (SELECT b.language FROM node_annotations b WHERE b.node_id=a.node_id AND b.placement=a.placement
          AND b.source_type IN ${textTypes} AND length(trim(json_extract(b.payload_json,'$.text')))>0
          ORDER BY CASE WHEN b.language=? THEN 0 WHEN b.language IS NULL THEN 1 ELSE 2 END,b.language,b.source_sequence LIMIT 1)`;
      const params = [JSON.stringify(context.nodes.map(n => n.id)), language];
      const total = this.db.prepare('SELECT count(*) total ' + base).get(...params).total;
      const rows = this.db.prepare(`SELECT a.source_sequence,a.placement,a.source_language,a.language,a.payload_json,n.source_path,s.stable_key,d.tree_hash,d.white,d.black,d.annotator ${base}
        ORDER BY a.document_id,n.source_index,a.source_sequence LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
      return { kind, page, pageSize, total, items: rows.map(a => ({ key: a.stable_key, treeHash: a.tree_hash, sourcePath: a.source_path,
        sequence: a.source_sequence, placement: a.placement, language: a.language, sourceLanguage: a.source_language,
        fallback: a.language !== language, text: JSON.parse(a.payload_json).text.slice(0, 4000),
        previewTruncated: JSON.parse(a.payload_json).text.length > 4000, white: a.white, black: a.black, annotator: a.annotator })) };
    })();
  }
  articleCatalog(request) {
    plain(request); only(request, ['revision','query','page','pageSize']); this.assertCurrent(request.revision);
    const query = boundedString(request.query ?? '', 256, 'article search').normalize('NFKC').toLowerCase();
    const page = positive(request.page, 1_000_000, 1), pageSize = positive(request.pageSize, 50, 20);
    const total = this.db.prepare('SELECT count(*) n FROM articles WHERE instr(search_title,?)>0').get(query).n;
    const items = this.db.prepare(`SELECT a.title,s.stable_key key,c.original_path source FROM articles a JOIN source_items s ON s.id=a.item_id
      JOIN source_collections c ON c.id=s.collection_id WHERE instr(a.search_title,?)>0 ORDER BY a.search_title,a.id LIMIT ? OFFSET ?`).all(query, pageSize, (page - 1) * pageSize);
    return { page, pageSize, total, items };
  }
  article(request) {
    plain(request); only(request, ['revision','key','language','examplesPage']); this.assertCurrent(request.revision);
    const key = boundedString(request.key, 512, 'article key'), language = normalizeLanguage(boundedString(request.language ?? 'en', 16, 'reading language'));
    const article = this.db.prepare(`SELECT a.*,s.stable_key,c.original_path FROM articles a JOIN source_items s ON s.id=a.item_id
      JOIN source_collections c ON c.id=s.collection_id WHERE s.stable_key=?`).get(key);
    if (!article) throw new OpeningQueryError('NOT_FOUND', 'Article is unavailable in this library');
    const versions = this.db.prepare('SELECT id,source_language,language,meaningful FROM article_versions WHERE article_id=? ORDER BY id').all(article.id);
    const readable = versions.filter(v => v.meaningful);
    const chosen = readable.find(v => v.language === language) ?? readable.find(v => v.language === 'en') ?? readable[0] ?? versions[0];
    const version = chosen ? this.db.prepare('SELECT * FROM article_versions WHERE id=?').get(chosen.id) : null;
    const candidateGet = this.db.prepare(`SELECT d.id,d.white,d.black,d.tree_hash,c.original_path FROM study_documents d
      JOIN source_items s ON s.id=d.item_id JOIN source_collections c ON c.id=s.collection_id WHERE s.stable_key=?`);
    const targets = chosen ? this.db.prepare(`SELECT t.*,d.tree_hash,s.stable_key document_key,ai.stable_key article_key FROM article_targets t
      LEFT JOIN study_documents d ON d.id=t.document_id LEFT JOIN source_items s ON s.id=d.item_id
      LEFT JOIN articles a ON a.id=t.article_id LEFT JOIN source_items ai ON ai.id=a.item_id WHERE t.version_id=?`).all(chosen.id).map(t => ({
      anchor: t.anchor_key, kind: t.kind, status: t.status, documentKey: t.document_key, treeHash: t.tree_hash,
      articleKey: t.article_key, positionHint: t.raw_position_hint, evidence: (() => {
        const evidence = JSON.parse(t.evidence_json);
        if (Array.isArray(evidence.candidates)) evidence.candidates = evidence.candidates.map(candidate => {
          const d = candidate.stableKey ? candidateGet.get(candidate.stableKey) : null;
          return { ...candidate, documentId: d?.id ?? null, white: d?.white ?? null, black: d?.black ?? null,
            treeHash: d?.tree_hash ?? null, source: d?.original_path ?? null };
        });
        return evidence;
      })(),
    })) : [];
    const examplesPage = positive(request.examplesPage, 1_000_000, 1);
    const examplesTotal = this.db.prepare('SELECT count(DISTINCT document_id) n FROM article_document_relations WHERE article_id=?').get(article.id).n;
    const examples = this.db.prepare(`SELECT d.white,d.black,d.tree_hash,s.stable_key key,group_concat(DISTINCT r.evidence_kind) evidence
      FROM article_document_relations r JOIN study_documents d ON d.id=r.document_id JOIN source_items s ON s.id=d.item_id
      WHERE r.article_id=? GROUP BY d.id ORDER BY d.id LIMIT 20 OFFSET ?`).all(article.id, (examplesPage - 1) * 20)
      .map(e => ({ key: e.key, white: e.white, black: e.black, treeHash: e.tree_hash, evidence: e.evidence.split(',') }));
    const notices = this.db.prepare("SELECT code,detail FROM quality_issues WHERE item_id=? AND stage='articles' ORDER BY id LIMIT 100").all(article.item_id);
    const result = { key, title: version?.title || article.title, source: article.original_path, language: chosen?.language ?? null,
      sourceLanguage: chosen?.source_language ?? null, fallback: chosen?.language !== language,
      availableLanguages: readable.map(v => ({ language: v.language, sourceLanguage: v.source_language })),
      meaningful: Boolean(chosen?.meaningful), blocks: version ? JSON.parse(version.blocks_json) : [], targets,
      examples, examplesPage, examplesTotal, notices };
    if (Buffer.byteLength(JSON.stringify(result)) > 8 * 1024 * 1024) throw new OpeningQueryError('LIMIT_EXCEEDED', 'Article exceeds display limit');
    return result;
  }
  study(request) {
    plain(request); only(request, ['revision','key','treeHash','sourcePath','expectedPositionKey','token']); this.assertCurrent(request.revision);
    const context = request.token === undefined ? null : this.context(request);
    const key = boundedString(request.key, 512, 'document key');
    const path = boundedString(request.sourcePath ?? '', 8192, 'source path');
    if (!/^(?:\d+(?:\.\d+)*)?$/.test(path)) invalid('Invalid source path');
    if (request.treeHash !== undefined && !/^[0-9a-f]{64}$/.test(request.treeHash)) invalid('Invalid tree hash');
    if (request.expectedPositionKey !== undefined) boundedString(request.expectedPositionKey, 256, 'match position');
    const d = this.db.prepare(`SELECT d.*,s.stable_key,c.role,c.original_path FROM study_documents d JOIN source_items s ON s.id=d.item_id
      JOIN source_collections c ON c.id=s.collection_id WHERE s.stable_key=?`).get(key);
    if (!d) throw new OpeningQueryError('NOT_FOUND', 'Game record is unavailable or excluded from playback');
    if (d.node_count > 100_000) throw new OpeningQueryError('LIMIT_EXCEEDED', 'Source tree exceeds display limit');
    const nodes = this.db.prepare(`SELECT n.id,n.parent_id,n.child_ordinal,n.source_path,n.source_index,n.ply,n.move_uci,n.san,n.is_mainline,p.exact_key
      FROM study_nodes n JOIN positions p ON p.id=n.position_id WHERE n.document_id=? ORDER BY n.source_index`).all(d.id);
    const matchingPaths = context ? context.nodes.filter(n => n.document_id === d.id).map(n => n.source_path) : [];
    let match = nodes.find(n => n.source_path === path), notice = null;
    if (!match || (request.treeHash && request.treeHash !== d.tree_hash) || (request.expectedPositionKey && request.expectedPositionKey !== match.exact_key) ||
        (context && !matchingPaths.includes(path))) {
      match = nodes[0]; notice = 'Stored source match could not be verified; opened the source root';
    }
    const byId = new Map(nodes.map(n => [n.id, n])), route = [];
    for (let n = match; n.parent_id !== null; n = byId.get(n.parent_id)) {
      if (!byId.has(n.parent_id) || route.length >= 2048) throw new OpeningQueryError('INVALID_LIBRARY', 'Invalid source parent path');
      route.unshift(n.move_uci);
    }
    const position = parseSearchPosition(d.start_fen);
    for (const uci of route) { const move = parseUci(uci); if (!move || !position.isLegal(move)) throw new OpeningQueryError('INVALID_LIBRARY', 'Illegal stored source route'); position.play(move); }
    if (positionFingerprint(position).verificationKey !== match.exact_key) throw new OpeningQueryError('INVALID_LIBRARY', 'Source route position mismatch');
    const annotations = this.db.prepare('SELECT * FROM node_annotations WHERE document_id=? ORDER BY source_sequence').all(d.id).map(a => ({
      nodeId: a.node_id, sequence: a.source_sequence, type: a.source_type, sourceLanguage: a.source_language, language: a.language,
      placement: a.placement, payload: JSON.parse(a.payload_json), status: a.support_status, payloadHash: a.payload_hash,
    }));
    const result = { key, treeHash: d.tree_hash, white: d.white, black: d.black, event: d.event, date: d.played_date, result: d.result,
      eco: d.eco, annotator: d.annotator, source: d.original_path, role: d.role, startFen: d.start_fen,
      annotationCoverage: d.annotation_coverage, nodes: nodes.map(n => ({ id: n.id, parentId: n.parent_id, ordinal: n.child_ordinal,
        sourcePath: n.source_path, sourceIndex: n.source_index, ply: n.ply, uci: n.move_uci, san: n.san, mainline: Boolean(n.is_mainline), exactKey: n.exact_key })),
      annotations, matchPath: match.source_path, matchingPaths, notice };
    if (Buffer.byteLength(JSON.stringify(result)) > 16 * 1024 * 1024) throw new OpeningQueryError('LIMIT_EXCEEDED', 'Annotated source exceeds display payload limit');
    return result;
  }
}
