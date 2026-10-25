import { useEffect, useMemo, useState } from 'react';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { OpeningPositionBoard } from './OpeningPositionBoard';
import { nagDescription } from './nag-descriptions.mjs';
import type { OpeningAnnotation, OpeningSourceNode, OpeningStudy } from './opening-types';

function Annotation({ annotation: a }: { annotation: OpeningAnnotation }) {
  return <div className="opening-source-annotation" data-placement={a.placement}>
    <small>{a.placement} · {a.sourceLanguage || 'Untagged'} · source annotation {a.sequence}</small>
    {a.status !== 'supported' ? <p>Unsupported source annotation: {a.type}. Its original payload is retained in the library; no evaluation is inferred.</p>
      : a.payload.text !== undefined ? <p>{a.payload.text}</p>
      : a.payload.nags ? <p>{a.payload.nags.map((n, i) => <span key={i} title={nagDescription(n)}>${n} {nagDescription(n) || 'Source symbol'} </span>)}</p>
      : <p>{a.type === 'Arrows' ? 'Source arrows' : 'Source squares'} shown on the selected position.</p>}
  </div>;
}

export function OpeningExamplePreview({ study, notice, onClose, language, active, initialPath, initialFlipped = false, onPosition }: {
  study: OpeningStudy; notice?: string; onClose: () => void; language: string; active: boolean;
  initialPath?: string; initialFlipped?: boolean; onPosition?: (sourcePath: string, flipped: boolean) => void;
}) {
  const [path, setPath] = useState(initialPath ?? study.matchPath), [flipped, setFlipped] = useState(initialFlipped);
  const [allLanguages, setAllLanguages] = useState(false);
  const { byId, byPath, children } = useMemo(() => {
    const byId = new Map(study.nodes.map(n => [n.id, n])), byPath = new Map(study.nodes.map(n => [n.sourcePath, n]));
    const children = new Map<number, OpeningSourceNode[]>();
    for (const n of study.nodes) if (n.parentId !== null) children.set(n.parentId, [...children.get(n.parentId) ?? [], n]);
    for (const list of children.values()) list.sort((a, b) => a.ordinal - b.ordinal);
    return { byId, byPath, children };
  }, [study]);
  const selected = byPath.get(path) ?? byPath.get('')!;
  const route = useMemo(() => {
    const result: OpeningSourceNode[] = [];
    for (let n: OpeningSourceNode | undefined = selected; n; n = n.parentId === null ? undefined : byId.get(n.parentId)) result.unshift(n);
    return result;
  }, [byId, selected]);
  const moves = useMemo(() => route.flatMap(n => n.uci ? [n.uci] : []), [route]);
  const annotations = study.annotations.filter(a => a.nodeId === selected.id);
  const visible = annotations.filter(a => {
    if (allLanguages || a.payload.text === undefined) return true;
    const bucket = annotations.filter(b => b.payload.text !== undefined && b.placement === a.placement);
    const chosen = bucket.find(b => b.language === language) ?? bucket.find(b => b.language === null) ?? bucket[0];
    return a.language === chosen?.language;
  });
  const shapes = useMemo<DrawShape[]>(() => study.annotations.filter(a => a.nodeId === selected.id && a.status === 'supported').flatMap(a => [
    ...(a.payload.arrows ?? []).map(s => ({ orig: s.from as Key, dest: s.to as Key, brush: s.color })),
    ...(a.payload.squares ?? []).map(s => ({ orig: s.square as Key, brush: s.color })),
  ]), [study, selected.id]);
  useEffect(() => { onPosition?.(selected.sourcePath, flipped); }, [selected.sourcePath, flipped, onPosition]);
  const next = children.get(selected.id) ?? [];
  return <section className="opening-example-preview" aria-label="Opening source example" tabIndex={0} onKeyDown={event => {
    if (!active || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('button,input,select,textarea'))) return;
    if (event.key === 'ArrowLeft' && route.length > 1) { setPath(route.at(-2)!.sourcePath); event.preventDefault(); }
    if (event.key === 'ArrowRight' && next[0]) { setPath(next[0].sourcePath); event.preventDefault(); }
    if (event.key === 'Home') { setPath(''); event.preventDefault(); }
  }}><button type="button" onClick={onClose}>Back to study</button>
    <h2>{study.white || 'Unknown'} — {study.black || 'Unknown'}</h2><p>{[study.event, study.date, study.eco, study.result].filter(Boolean).join(' · ')}</p>
    {(study.notice || notice) && <p className="notice" role="status">{study.notice || notice}</p>}
    <p>{study.source} · {study.annotator ? `Annotations: ${study.annotator}` : 'Source author unspecified'} · branch {selected.sourcePath || 'root'}</p>
    <div className="opening-review-layout"><div><div className="opening-preview-board"><OpeningPositionBoard initialFen={study.startFen} moves={moves} flipped={flipped} active={active} shapes={shapes} /></div>
      <div className="opening-review-controls"><button type="button" onClick={() => setPath('')}>Source root</button>
        <button type="button" disabled={route.length < 2} onClick={() => setPath(route.at(-2)!.sourcePath)}>Previous move</button>
        <button type="button" disabled={!next[0]} onClick={() => setPath(next[0].sourcePath)}>Next move</button>
        <button type="button" onClick={() => setFlipped(value => !value)}>Flip review board</button></div>
      <nav aria-label="Source move path">{route.map(n => <button type="button" key={n.id} aria-current={n.id === selected.id ? 'step' : undefined} onClick={() => setPath(n.sourcePath)}>{n.san ? `${n.ply}. ${n.san}` : 'Root'}</button>)}</nav>
      <div aria-label="Source continuations"><h3>Source continuations</h3>{next.length ? next.map(n => <button type="button" key={n.id} onClick={() => setPath(n.sourcePath)}>{n.san} · branch {n.sourcePath}{n.mainline ? ' · main line' : ' · variation'}</button>) : <p>End of this source line.</p>}</div>
    </div><div className="opening-review-comments" data-opening-scroll tabIndex={0} aria-label="Source annotations">
      <h3>Selected source annotations</h3><label><input type="checkbox" checked={allLanguages} onChange={e => setAllLanguages(e.target.checked)} />Show all source languages</label>
      {visible.some(a => a.payload.text !== undefined && a.language !== language) && <p className="notice">Requested comment language unavailable here. Showing the labelled source fallback.</p>}
      {visible.map(a => <Annotation key={a.sequence} annotation={a} />)}{!visible.length && <p>No annotations on this source node.</p>}
      {study.annotations.some(a => a.nodeId === null) && <details><summary>Unmapped source annotations</summary>{study.annotations.filter(a => a.nodeId === null).map(a => <Annotation key={a.sequence} annotation={a} />)}</details>}
      <p>Annotation coverage: {study.annotationCoverage}. Navigation follows the original child order, including duplicate moves. Evaluations with unverified perspective or offsets remain unsupported.</p>
    </div></div>
  </section>;
}
