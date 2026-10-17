import { createHash } from 'node:crypto';
import { decompress } from 'fzstd';
import { reviewPgn } from '../src/pgn.mjs';
export const POLICY_VERSION = 'annotated-editions-1';
export const FEATURE_VERSION = 'review-parser-2';
export const searchKey = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('und');
export const legacyGameKey = (source, record) => 'legacy:' + JSON.stringify([source, record]);
export function decodePgn(row) {
  if (!(row.pgn_zstd instanceof Uint8Array) || row.pgn_zstd.length > 16 * 1024 * 1024) throw new Error('Invalid compressed PGN size');
  const bytes = decompress(row.pgn_zstd);
  if (bytes.length > 16 * 1024 * 1024) throw new Error('Invalid decoded PGN size');
  if (createHash('sha256').update(bytes).digest('hex') !== row.pgn_sha256) throw new Error('PGN SHA-256 check failed');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export const retention = row => row.record_kind === 'game' ? { retain: true, reason: 'game' } : { retain: false, reason: 'standalone-' + row.record_kind };
export const resultCode = result => ({ '1-0': 'white_win', '0-1': 'black_win', '1/2-1/2': 'draw', '*': 'unfinished' })[result] ?? 'unknown';
export function completeness(extras = {}) {
  const trusted = extras.completeness;
  return trusted && typeof trusted === 'object' && ['complete', 'partial'].includes(trusted.value) && typeof trusted.evidence === 'string' && trusted.evidence.trim()
    ? { value: trusted.value, evidence: trusted.evidence } : { value: 'unknown', evidence: null };
}
export function extractFeatures(pgn) {
  try {
    const { tokens, positionError } = reviewPgn(pgn);
    if (positionError) throw new Error(positionError);
    if (tokens.some(t => t.type === 'move' && typeof t.path !== 'string')) throw new Error('Illegal or unreachable move in score');
    const moves = tokens.filter(t => t.type === 'move' && typeof t.path === 'string');
    const facts = {
      critical_position_count: moves.filter(t => t.critical?.length).length,
      medal_count: moves.reduce((n,t) => n + (t.medals?.length ?? 0), 0),
      comments: Number(tokens.some(t => t.type === 'comment')),
      variations: Number(tokens.some(t => t.type === 'variation-start')),
      nags: Number(moves.some(t => t.nags?.length)),
      board_annotations: Number(/\[%(?:cal|csl|diagram)\b|\$220\b/.test(pgn)),
    };
    return { status: 'complete', ...facts, annotated: Number(Object.values(facts).some(Boolean)), diagnostic: null };
  } catch (error) { return { status: 'error', diagnostic: error.message }; }
}
export function inventory(db) {
  const version = db.pragma('user_version', { simple: true });
  if (![3,4,5,6].includes(version)) throw new Error('Expected legacy schema 3–6, found ' + version);
  const report = { policy: POLICY_VERSION, version, total: 0, retained: 0, excluded: [], kinds: {}, deleted: 0, training: 0, sources: 0, names: {}, parseErrors: [], corrupt: [], candidates: [], featureCoverage: {}, completenessUnknown: 0 };
  const names = Object.fromEntries(['white','black','annotator','event','site'].map(k => [k,new Set()]));
  for (const row of db.prepare('SELECT g.*,s.source_key FROM games g JOIN sources s ON s.id=g.source_id').iterate()) {
    report.total++; report.kinds[row.record_kind] = (report.kinds[row.record_kind] ?? 0) + 1;
    report.deleted += row.is_deleted; report.training += row.is_training;
    let decoded;
    try { decoded=decodePgn(row); } catch(error) { report.corrupt.push({id:row.id,error:error.message}); }
    const decision = retention(row);
    if (!decision.retain) { report.excluded.push({ id: row.id, source: row.source_key, key: row.source_game_key, reason: decision.reason }); if (row.white && row.black && row.record_kind !== 'text') report.candidates.push(row.id); continue; }
    report.retained++;
    for (const key in names) if (row[key]) names[key].add(row[key]);
    if (completeness(JSON.parse(row.extras_json ?? '{}')).value === 'unknown') report.completenessUnknown++;
    for (const key of ['critical_position_count','medal_count']) if (row[key] != null) report.featureCoverage[key] = (report.featureCoverage[key] ?? 0) + 1;
    if(decoded!==undefined) { const features=extractFeatures(decoded); if(features.status==='error') report.parseErrors.push({id:row.id,error:features.diagnostic}); }
  }
  report.breakdown = db.prepare('SELECT record_kind,is_deleted,is_training,count(*) n FROM games GROUP BY record_kind,is_deleted,is_training').all();
  report.sources = db.prepare('SELECT count(*) n FROM sources').get().n;
  report.sourceRecords = db.prepare('SELECT count(*) n FROM source_records').get().n;
  report.names = Object.fromEntries(Object.entries(names).map(([k,v]) => [k,v.size]));
  if (report.total !== report.retained + report.excluded.length) throw new Error('Inventory does not reconcile');
  return report;
}
