import { Node, ChildNode, makePgn } from 'chessops/pgn';
import { nagDescription } from './nag-descriptions.mjs';
import { ordinalPathPart } from './pgn.mjs';

export const sourceReviewPath = path => path ? path.split('.').map(Number).map(ordinalPathPart).join('') : '';
export const reviewSourcePath = path => Array.from({ length: path.length / 2 }, (_, i) =>
  ((path.charCodeAt(i * 2) - 256) << 8) + path.charCodeAt(i * 2 + 1) - 256).join('.');

// Only the validated runtime tree supplies the review score. Never use the
// archive's derived PGN or merge duplicate move siblings.
export function openingReviewGame(study, language, allLanguages = false) {
  const headers = new Map(Object.entries({ White: study.white || '?', Black: study.black || '?',
    Event: study.event || '?', Date: study.date || '?', Result: study.result || '*',
    ECO: study.eco || '?', Annotator: study.annotator || '?', SetUp: '1', FEN: study.startFen }));
  const moves = new Node(), nodes = new Map(), annotations = new Map();
  for (const node of study.nodes) nodes.set(node.id, node.parentId === null ? moves : new ChildNode({ san: node.san }));
  for (const node of [...study.nodes].sort((a, b) => a.ordinal - b.ordinal)) {
    if (node.parentId !== null) nodes.get(node.parentId).children.push(nodes.get(node.id));
  }
  for (const a of [...study.annotations].sort((a, b) => a.sequence - b.sequence)) {
    const list = annotations.get(a.nodeId) || [];
    list.push(a); annotations.set(a.nodeId, list);
  }
  const rootId = study.nodes.find(n => n.parentId === null).id;
  for (const [id, list] of annotations) {
    const node = nodes.get(id), root = id === rootId || !node;
    for (const a of list) {
      const bucket = list.filter(b => b.payload.text !== undefined && b.placement === a.placement);
      const chosen = bucket.find(b => b.language === language) || bucket.find(b => b.language === null) || bucket[0];
      if (!allLanguages && a.payload.text !== undefined && a.language !== chosen?.language) continue;
      let text = '', drawing = false;
      if (a.status !== 'supported') text = `Unsupported source annotation: ${a.type}. Original payload retained in the library; no evaluation inferred.`;
      else if (a.payload.text !== undefined) text = `${allLanguages || a.language !== language ? '[' + (a.sourceLanguage || 'Untagged') + '] ' : ''}${a.payload.text}`;
      else {
        if (a.payload.nags) {
          if (node && !root) node.data.nags = [...node.data.nags || [], ...a.payload.nags];
          else { text = a.payload.nags.map(nag => '$' + nag + ' ' + (nagDescription(nag) || 'Source symbol')).join(', '); drawing = false; }
        }
        drawing = !!(a.payload.arrows || a.payload.squares);
        const colors = { green: 'G', red: 'R', blue: 'B', yellow: 'Y' };
        if (a.payload.arrows) text = '[%cal ' + a.payload.arrows.map(s => colors[s.color] + s.from + s.to).join(',') + ']';
        if (a.payload.squares) text = '[%csl ' + a.payload.squares.map(s => colors[s.color] + s.square).join(',') + ']';
      }
      if (!text) continue;
      if (!node) text = 'Unmapped source annotation. ' + text;
      // Prose remains literal, including braces and strings resembling PGN directives.
      const comment = drawing ? text : '[%openingtext ' + btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join('')) + ']';
      if (root) moves.comments = [...moves.comments || [], comment];
      else {
        const field = a.placement === 'before' ? 'startingComments' : 'comments';
        node.data[field] = [...node.data[field] || [], comment];
      }
    }
  }
  return { id: 0, personal: { lines: [], comments: [] }, pgn: makePgn({ headers, moves, comments: moves.comments }),
    white: study.white, black: study.black, event: study.event, site: null, date: study.date,
    result: study.result, eco: study.eco, start_fen: study.startFen, source_title: study.source, favourite: 0 };
}
