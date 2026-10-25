import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSearchPosition } from './position-hash.mjs';
import { digest } from './opening-source-tree.mjs';
import { checkpointItem, BUILD_VERSIONS } from './opening-library-storage.mjs';

export const normalizeLanguage = language => ({ ENGLISH: 'en', ENG: 'en', GERMAN: 'de', GER: 'de',
  FRENCH: 'fr', FRE: 'fr', SPANISH: 'es', SPA: 'es', ITALIAN: 'it', ITA: 'it', DUTCH: 'nl',
  DUT: 'nl', PORTUGUESE: 'pt', POR: 'pt', UNKNOWN: 'und' })[language] ?? language?.toLowerCase() ?? 'und';

export function readingBlocks(bodies) {
  const processResult = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    [fileURLToPath(new URL('../scripts/opening-reading-blocks.py', import.meta.url))], {
      input: JSON.stringify(bodies), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
  if (processResult.error || processResult.status !== 0) throw new Error(`Offline article parser failed: ${processResult.error?.message ?? processResult.stderr}`);
  const results = JSON.parse(processResult.stdout);
  function validateDiagrams(blocks) {
    for (const block of blocks) {
      if (block.type === 'diagram_candidate') {
        const fen = block.raw_fen;
        delete block.raw_fen;
        try { parseSearchPosition(fen); block.type = 'diagram'; block.fen = fen; }
        catch { block.type = 'unavailable'; block.text = 'Source diagram has an invalid or unsupported FEN'; }
      }
      if (block.children) validateDiagrams(block.children);
    }
  }
  for (const result of results) validateDiagrams(result.blocks);
  return results;
}

export function createArticleConverter(db, input) {
  const catalogInsert = db.prepare('INSERT OR IGNORE INTO articles(id,item_id,title,search_title) VALUES (?,?,?,?)');
  // Preseed the catalog so forward article references retain exact identities.
  db.transaction(() => {
    for (const a of input.prepare('SELECT a.id,a.primary_title FROM articles a JOIN source_records s ON s.id=a.id WHERE s.source_deleted=0 ORDER BY a.id').iterate()) {
      const title = a.primary_title || 'Untitled article';
      catalogInsert.run(a.id, a.id, title, title.normalize('NFKC').toLowerCase());
    }
  })();
  const bodiesGet = input.prepare('SELECT * FROM article_bodies WHERE article_id=? ORDER BY id');
  const linksGet = input.prepare(`SELECT id,line,column_no,resolution_status,target_record_id,position_hint,resolution_json
    FROM article_links WHERE body_id=? ORDER BY ordinal`);
  const candidatesGet = input.prepare('SELECT game_id,evidence_json FROM article_link_candidates WHERE link_id=? ORDER BY game_id');
  const relationsGet = input.prepare('SELECT * FROM article_game_relations WHERE article_id=? ORDER BY id');
  const documentGet = db.prepare('SELECT id FROM study_documents WHERE item_id=?');
  const itemGet = db.prepare('SELECT stable_key,kind,validation_status FROM source_items WHERE id=?');
  const articleGet = db.prepare('SELECT id FROM articles WHERE item_id=?');
  const versionInsert = db.prepare(`INSERT INTO article_versions(article_id,source_language,language,title,blocks_json,
    plain_text,meaningful,source_hash,sanitizer_version) VALUES (?,?,?,?,?,?,?,?,?)`);
  const targetInsert = db.prepare(`INSERT INTO article_targets(version_id,anchor_key,kind,document_id,article_id,
    raw_position_hint,node_id,status,evidence_json) VALUES (?,?,?,?,?,?,NULL,?,?)`);
  const relationInsert = db.prepare('INSERT OR IGNORE INTO article_document_relations(article_id,document_id,evidence_kind) VALUES (?,?,?)');
  const relationGet = db.prepare('SELECT id FROM article_document_relations WHERE article_id=? AND document_id=? AND evidence_kind=?');
  const evidenceInsert = db.prepare('INSERT INTO relation_evidence(relation_id,source_locator,details_json) VALUES (?,?,?)');
  const issue = db.prepare(`INSERT INTO quality_issues(item_id,stage,severity,code,detail,disposition) VALUES (?,'articles','warning',?,?,?)`);
  return function convert(itemId) {
    return checkpointItem(db, itemId, item => {
      if (item.kind !== 'article') throw new Error('Article converter requires an article item');
      if (item.deleted) { db.prepare('DELETE FROM articles WHERE item_id=?').run(itemId); return { status: 'deleted' }; }
      const bodies = bodiesGet.all(itemId);
      const normalized = readingBlocks(bodies.map(b => b.content));
      for (const [i, b] of bodies.entries()) {
        const result = normalized[i];
        const versionId = versionInsert.run(itemId, b.language, normalizeLanguage(b.language), b.title,
          JSON.stringify(result.blocks), result.plain_text, Number(result.meaningful), digest(b.content), BUILD_VERSIONS.sanitizer).lastInsertRowid;
        if (result.fallback || result.malformed) issue.run(itemId, 'safe_body_fallback',
          `Language ${b.language}: ${result.fallback ? 'whole body' : 'recovered malformed markup'}`, 'safe_reading_blocks_with_notice');
        const links = new Map(linksGet.all(b.id).map(l => [`${l.line}:${l.column_no}`, l]));
        for (const anchor of new Set(result.links)) {
          const link = links.get(anchor);
          const target = link?.target_record_id && ['resolved_game','resolved_record_id','resolved_title'].includes(link.resolution_status)
            ? itemGet.get(link.target_record_id) : null;
          const documentId = target?.kind === 'game' ? documentGet.get(link.target_record_id)?.id ?? null : null;
          const articleId = target?.kind === 'article' ? articleGet.get(link.target_record_id)?.id ?? null : null;
          const candidates = link ? candidatesGet.all(link.id).map(c => ({
            stableKey: itemGet.get(c.game_id)?.stable_key ?? null, documentId: documentGet.get(c.game_id)?.id ?? null,
            evidence: JSON.parse(c.evidence_json),
          })) : [];
          const status = documentId || articleId ? 'resolved' : candidates.length ? 'ambiguous' : 'unavailable';
          targetInsert.run(versionId, anchor, documentId ? 'game' : articleId ? 'article' : 'unavailable',
            documentId, articleId, link?.position_hint ?? null, status,
            JSON.stringify({ sourceLinkId: link?.id ?? null, sourceStatus: link?.resolution_status ?? 'unmapped_locator',
              stableKey: target?.stable_key ?? null, candidates, resolution: link ? JSON.parse(link.resolution_json) : {},
              notice: link?.position_hint ? 'Position hint is unvalidated; open the referenced root' : null }));
        }
      }
      for (const r of relationsGet.all(itemId)) {
        const documentId = documentGet.get(r.game_id)?.id;
        if (!documentId) { issue.run(itemId, 'unavailable_example', `Source game ${r.game_id}`, 'retained_as_unavailable'); continue; }
        const kind = ({ explicit_game_link: 'explicit_link', same_source_database: 'same_source' })[r.relation_type];
        if (!kind) { issue.run(itemId, 'unsupported_relation', r.relation_type, 'not_expanded'); continue; }
        relationInsert.run(itemId, documentId, kind);
        evidenceInsert.run(relationGet.get(itemId, documentId, kind).id, `source-relation:${r.id}`,
          JSON.stringify({ sourceLinkId: r.link_id, positionHint: r.position_hint, evidence: JSON.parse(r.evidence_json) }));
      }
      return { status: 'accepted' };
    });
  };
}
