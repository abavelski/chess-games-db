import { parsePgn, startingPosition } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { positionFingerprint } from './position-hash.mjs';
import { readSourceTree, normalizeAnnotations, generateViewerPgn, digest } from './opening-source-tree.mjs';
import { checkpointItem } from './opening-library-storage.mjs';

// Independent parse/replay of generated notation. Check actual source branch
// ordinals and positions; matching SAN or a move-encoded path is insufficient.
export function verifyGeneratedTree(tree, annotations) {
  const [game] = parsePgn(generateViewerPgn(tree, annotations));
  if (!game) throw new Error('Generated notation could not be parsed');
  let count = 0;
  const recovered = [];
  function comments(list) {
    for (const text of list ?? []) {
      const match = /^\[%opening ([A-Za-z0-9+/=]+)\]$/.exec(text);
      if (!match) throw new Error('Generated annotation could not be recovered');
      recovered.push(JSON.parse(Buffer.from(match[1], 'base64')));
    }
  }
  comments(game.comments);
  function visit(source, target, position) {
    if (source.children.length !== target.children.length) throw new Error('Generated branch count changed');
    for (let i = 0; i < source.children.length; i++) {
      const a = source.children[i], b = target.children[i];
      const move = parseSan(position, b.data.san);
      if (!move || !position.isLegal(move) || makeUci(move) !== a.uci) throw new Error('Generated move/path mismatch');
      const next = position.clone(); next.play(move);
      if (positionFingerprint(next).verificationKey !== a.exactKey) throw new Error('Generated position mismatch');
      comments(b.data.startingComments); comments(b.data.comments);
      count++;
      visit(a, b, next);
    }
  }
  visit(tree.root, game.moves, startingPosition(game.headers).unwrap());
  if (count !== tree.moveCount || JSON.stringify(recovered.sort((a, b) => a.sequence - b.sequence)) !==
      JSON.stringify(annotations.filter(a => a.sourcePath !== null))) throw new Error('Generated annotation/tree reconciliation failed');
}

export function createTreeConverter(db) {
  const positionInsert = db.prepare('INSERT OR IGNORE INTO positions(hash,exact_key) VALUES (?,?)');
  const positionGet = db.prepare('SELECT id FROM positions WHERE hash=? AND exact_key=?');
  const rootInsert = db.prepare('INSERT OR IGNORE INTO prefix_roots(position_id) VALUES (?)');
  const rootGet = db.prepare('SELECT id FROM prefix_roots WHERE position_id=?');
  const prefixInsert = db.prepare('INSERT OR IGNORE INTO move_prefixes(root_id,parent_id,depth,move_uci,position_id) VALUES (?,?,?,?,?)');
  const rootPrefix = db.prepare('SELECT id FROM move_prefixes WHERE parent_id IS NULL AND root_id=?');
  const childPrefix = db.prepare('SELECT id FROM move_prefixes WHERE parent_id=? AND move_uci=?');
  const documentInsert = db.prepare(`INSERT INTO study_documents(item_id,white,black,event,played_date,result,eco,annotator,
    search_text,start_fen,root_prefix_id,tree_hash,annotation_hash,annotation_coverage,node_count,leaf_count)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const nodeInsert = db.prepare(`INSERT INTO study_nodes(document_id,parent_id,child_ordinal,move_uci,san,ply,source_index,
    source_path,viewer_path,prefix_id,position_id,is_mainline,leaf_lo,leaf_hi) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const annotationInsert = db.prepare(`INSERT INTO node_annotations(document_id,node_id,source_sequence,source_type,source_language,
    language,placement,payload_json,original_json,payload_hash,support_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const issue = db.prepare(`INSERT INTO quality_issues(item_id,stage,severity,code,source_location,detail,disposition) VALUES (?,?,?,?,?,?,?)`);
  function getPosition(n) {
    positionInsert.run(n.hash, n.exactKey);
    return positionGet.get(n.hash, n.exactKey).id;
  }
  return function convert(itemId, source, sourceAnnotations) {
    return checkpointItem(db, itemId, item => {
      if (item.kind !== 'game') throw new Error('Tree converter requires a game item');
      if (item.deleted) return { status: 'deleted', annotations: sourceAnnotations.length };
      let tree;
      try {
        const errors = JSON.parse(source.errors_json ?? '[]');
        if (errors.some(e => /game_decode|record_decode/.test(e.stage))) throw new Error('Source move decoding failed');
        tree = readSourceTree(source);
      } catch (error) {
        const metadata = Object.fromEntries(['white','black','event','played_date','result','eco','annotator','start_fen']
          .map(key => [key, source[key] == null ? null : String(source[key]).slice(0, 512)]));
        issue.run(itemId, 'moves', 'error', 'tree_quarantined', null,
          JSON.stringify({ reason: String(error.message).slice(0, 2048), metadata }),
          JSON.stringify({ status: 'excluded_tree', annotations: sourceAnnotations.length }));
        return { status: 'quarantined', annotations: sourceAnnotations.length };
      }
      if (!tree.moveCount) {
        issue.run(itemId, 'moves', 'info', 'empty_tree', null, 'No playable moves',
          JSON.stringify({ status: 'metadata_only', annotations: sourceAnnotations.length }));
        return { status: 'metadata_only', annotations: sourceAnnotations.length };
      }
      const annotations = normalizeAnnotations(tree, sourceAnnotations);
      verifyGeneratedTree(tree, annotations);
      const partial = annotations.some(a => a.status !== 'supported') ||
        source.annotations_decode_status !== 'decoded_not_validated' || JSON.parse(source.errors_json ?? '[]').length > 0;
      const rootPositionId = getPosition(tree.root);
      rootInsert.run(rootPositionId);
      const rootId = rootGet.get(rootPositionId).id;
      prefixInsert.run(rootId, null, 0, null, rootPositionId);
      const rootPrefixId = rootPrefix.get(rootId).id;
      const annotationHash = digest(JSON.stringify(sourceAnnotations));
      const documentId = documentInsert.run(itemId, source.white ?? null, source.black ?? null, source.event ?? null,
        source.played_date ?? null, source.result ?? null, source.eco ?? null, source.annotator ?? null,
        [source.white, source.black, source.event, source.eco, source.annotator].filter(Boolean).join(' ').normalize('NFKC').toLowerCase(),
        source.start_fen, rootPrefixId, tree.treeHash, annotationHash, partial ? 'partial' : 'complete', tree.moveCount, tree.leafCount).lastInsertRowid;
      const ids = new Map(), pathIds = new Map();
      for (const n of tree.nodes) {
        const positionId = getPosition(n), parent = n.parent ? ids.get(n.parent) : null;
        if (parent) prefixInsert.run(rootId, parent.prefixId, n.ply, n.uci, positionId);
        const prefixId = parent ? childPrefix.get(parent.prefixId, n.uci).id : rootPrefixId;
        const nodeId = nodeInsert.run(documentId, parent?.nodeId ?? null, n.ordinal, n.uci, n.san, n.ply,
          n.sourceIndex, n.path.join('.'), n.viewerPath, prefixId, positionId, Number(n.mainline), n.leafLo, n.leafHi).lastInsertRowid;
        ids.set(n, { nodeId, prefixId }); pathIds.set(n.path.join('.'), nodeId);
      }
      for (const a of annotations) {
        annotationInsert.run(documentId, pathIds.get(a.sourcePath) ?? null, a.sequence, a.type, a.sourceLanguage,
          a.language, a.placement, JSON.stringify(a.payload), JSON.stringify(a.original), a.payloadHash, a.status);
        if (a.status !== 'supported') issue.run(itemId, 'annotations', 'warning', `annotation_${a.status}`,
          `sequence:${a.sequence}/move:${a.sourceIndex}`, a.type, 'retained_decoded_payload');
      }
      if (source.annotations_decode_status !== 'decoded_not_validated') issue.run(itemId, 'annotations', 'warning',
        'source_annotation_decode_partial', null, source.annotations_decode_status ?? 'missing status', 'playable_complete_annotations_partial');
      return { status: 'accepted', nodes: tree.nodes.length, annotations: annotations.length };
    });
  };
}
