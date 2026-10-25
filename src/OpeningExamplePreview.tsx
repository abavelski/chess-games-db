import { useMemo } from 'react';
import { OpeningPositionBoard } from './OpeningPositionBoard';
import type { OpeningStudy } from './opening-types';

export function OpeningExamplePreview({ study, notice, onClose }: { study: OpeningStudy; notice?: string; onClose: () => void }) {
  const moves = useMemo(() => {
    const byId = new Map(study.nodes.map(n => [n.id, n])), selected = study.nodes.find(n => n.sourcePath === study.matchPath);
    const route: string[] = [];
    for (let node = selected; node?.parentId !== null && node?.parentId !== undefined; node = byId.get(node.parentId)) if (node.uci) route.unshift(node.uci);
    return route;
  }, [study]);
  return <section className="opening-example-preview" aria-label="Opening source example"><button type="button" onClick={onClose}>Back to study</button>
    <h2>{study.white || 'Unknown'} — {study.black || 'Unknown'}</h2><p>{[study.event, study.date, study.eco].filter(Boolean).join(' · ')}</p>
    {(study.notice || notice) && <p className="notice" role="status">{study.notice || notice}</p>}
    <div className="opening-preview-board"><OpeningPositionBoard initialFen={study.startFen} moves={moves} /></div>
    <p>{study.source} · branch {study.matchPath || 'root'}</p>
  </section>;
}
