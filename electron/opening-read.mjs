import { gameQuery } from './queries.mjs';

export function activeOpeningRevision(db, supported) {
  return supported ? db.prepare("SELECT r.id FROM opening_state s JOIN opening_revisions r ON r.id=s.revision_id WHERE r.status='complete'").get()?.id ?? null : null;
}

export function openingSelection(db, revision, selection) {
  if (selection === undefined || selection === null || selection === '') return { clause: '', params: {} };
  if (!revision) throw new Error('Opening catalogue is not enriched in this archive.');
  if (typeof selection !== 'string' || (selection !== 'unclassified' && !db.prepare('SELECT 1 FROM opening_nodes WHERE revision_id=? AND id=?').get(revision, selection))) throw new Error('Invalid or stale opening selection. Clear the opening filter.');
  const params = { openingRevision: revision };
  if (selection === 'unclassified') return { clause: `NOT EXISTS (SELECT 1 FROM game_openings o WHERE o.revision_id=@openingRevision AND o.game_id=g.id AND o.pgn_sha256=g.pgn_sha256 AND o.status='matched')`, params };
  params.openingDescendants = JSON.stringify(db.prepare(`WITH RECURSIVE descendants(id) AS (
    SELECT id FROM opening_nodes WHERE revision_id=? AND id=?
    UNION ALL SELECT n.id FROM opening_nodes n JOIN descendants d ON n.parent_id=d.id WHERE n.revision_id=?
  ) SELECT id FROM descendants`).all(revision, selection, revision).map(row => row.id));
  return { clause: `EXISTS (
    SELECT 1 FROM game_opening_matches m
    JOIN game_openings o ON o.revision_id=m.revision_id AND o.game_id=m.game_id
    JOIN opening_entries e ON e.revision_id=m.revision_id AND e.id=m.entry_id
    WHERE m.revision_id=@openingRevision AND m.game_id=g.id AND o.pgn_sha256=g.pgn_sha256 AND o.status='matched'
      AND e.node_id IN (SELECT value FROM json_each(@openingDescendants))
  )`, params };
}

export function openingLabels(db, revision, rows) {
  if (!rows.length || !revision) return rows.map(row => ({ ...row, opening: { status: 'unenriched', name: null, eco: null, nodeId: null, path: [], matchedPly: null } }));
  const labels = db.prepare(`SELECT o.game_id, o.status, o.matched_ply, e.name, e.eco, e.node_id, n.path_json
    FROM game_openings o JOIN games g ON g.id=o.game_id AND g.pgn_sha256=o.pgn_sha256
    LEFT JOIN opening_entries e ON e.revision_id=o.revision_id AND e.id=o.primary_entry_id
    LEFT JOIN opening_nodes n ON n.revision_id=e.revision_id AND n.id=e.node_id
    WHERE o.revision_id=? AND o.game_id IN (${rows.map(() => '?').join(',')})`).all(revision, ...rows.map(row => row.id));
  const byGame = new Map(labels.map(row => [row.game_id, row]));
  return rows.map(row => {
    const label = byGame.get(row.id);
    return { ...row, opening: { status: label?.status ?? 'unenriched', name: label?.name ?? null, eco: label?.eco ?? null,
      nodeId: label?.node_id ?? null, path: label?.path_json ? JSON.parse(label.path_json) : [], matchedPly: label?.matched_ply ?? null } };
  });
}

export function openingFacets(db, supported, filters = {}) {
  const revision = activeOpeningRevision(db, supported);
  const q = gameQuery({ ...filters, kind: 'game', deleted: 'active' });
  const from = ' FROM games g JOIN sources s ON s.id=g.source_id';
  const total = db.prepare('SELECT count(*) n' + from + q.where).get(q.params).n;
  if (!revision) return { supported, revision: null, total, classified: 0, unclassified: total, nodes: [] };
  const params = { ...q.params, facetRevision: revision };
  const classified = db.prepare(`SELECT count(*) n${from}${q.where} AND EXISTS (SELECT 1 FROM game_openings o WHERE o.revision_id=@facetRevision AND o.game_id=g.id AND o.pgn_sha256=g.pgn_sha256 AND o.status='matched')`).get(params).n;
  // Materialize the filtered game IDs first. A broad SQL ancestry join can
  // otherwise rescan every match for every taxonomy node on real archives.
  const matches = db.prepare(`WITH eligible AS MATERIALIZED (SELECT g.id,g.pgn_sha256${from}${q.where})
    SELECT DISTINCT g.id,e.node_id FROM eligible g
    CROSS JOIN game_openings o ON o.game_id=g.id AND o.pgn_sha256=g.pgn_sha256 AND o.revision_id=@facetRevision AND o.status='matched'
    CROSS JOIN game_opening_matches m ON m.game_id=o.game_id AND m.revision_id=o.revision_id
    CROSS JOIN opening_entries e ON e.id=m.entry_id AND e.revision_id=m.revision_id`).all(params);
  const tree = db.prepare('SELECT * FROM opening_nodes WHERE revision_id=?').all(revision);
  const byId = new Map(tree.map(node => [node.id, node]));
  const gamesByNode = new Map();
  for (const match of matches) {
    let node = byId.get(match.node_id);
    while (node) {
      let games = gamesByNode.get(node.id);
      if (!games) { games = new Set(); gamesByNode.set(node.id, games); }
      games.add(match.id); node = byId.get(node.parent_id);
    }
  }
  const nodes = tree.filter(node => gamesByNode.has(node.id))
    .map(node => ({ id: node.id, label: node.label, parentId: node.parent_id, path: JSON.parse(node.path_json), count: gamesByNode.get(node.id).size }))
    .sort((a,b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return { supported, revision, total, classified, unclassified: total - classified, nodes };
}
