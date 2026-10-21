import { useEffect, useState } from 'react';
import { OpeningCombobox } from './OpeningCombobox';
import type { OpeningFacets, OpeningNode, SearchFilters } from './types';

export interface OpeningSelection { id: string; path: OpeningNode[] }

export function OpeningFilter({ filters, selection, onChange }: {
  filters: SearchFilters; selection: OpeningSelection | null; onChange: (value: OpeningSelection | null) => void;
}) {
  const [facets, setFacets] = useState<OpeningFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    const timer = setTimeout(() => {
      window.chessArchive.openingFacets(filters).then(value => { if (alive) setFacets(value); })
        .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); })
        .finally(() => { if (alive) setLoading(false); });
    }, 120);
    return () => { alive = false; clearTimeout(timer); };
  }, [filters]);

  const choose = (node: OpeningNode | null) => {
    if (!node) { onChange(null); return; }
    const path = [node];
    let parent = node.parentId;
    while (parent) {
      const ancestor = facets?.nodes.find(item => item.id === parent) ?? selection?.path.find(item => item.id === parent);
      if (!ancestor) break;
      path.unshift(ancestor); parent = ancestor.parentId;
    }
    onChange({ id: node.id, path });
  };
  const chosenPath = selection?.path ?? [];
  const levels: Array<{ label: string; options: OpeningNode[]; selected: string; depth: number }> = [];
  for (let depth = 0; depth <= chosenPath.length; depth++) {
    const parent = depth ? chosenPath[depth - 1].id : null;
    const options = (facets?.nodes ?? []).filter(node => node.parentId === parent);
    const selected = chosenPath[depth];
    if (selected && !options.some(node => node.id === selected.id)) options.push({ ...selected, count: 0 });
    if (depth && !options.length) break;
    levels.push({ label: depth === 0 ? 'Opening family' : depth === 1 ? 'Opening line' : depth === 2 ? 'Opening subline' : `Opening subline ${depth - 1}`,
      options, selected: depth === 0 && selection?.id === 'unclassified' ? 'unclassified' : selected?.id ?? '', depth });
    if (selection?.id === 'unclassified') break;
  }
  const available = !!facets?.revision;
  return <section className="opening-filter" aria-label="Opening filters" aria-busy={loading}>
    <div className="opening-filter-heading"><strong>Opening</strong>
      <span role="status">{loading ? 'Updating openings…' : available ? `${facets.classified.toLocaleString()} of ${facets.total.toLocaleString()} games classified` : ''}</span>
      {available && <label className="opening-unclassified-toggle">
        <input type="checkbox" checked={selection?.id === 'unclassified'} disabled={loading} onChange={event => {
          onChange(event.target.checked ? { id: 'unclassified', path: [] } : null);
        }} />
        Unclassified only ({facets.unclassified.toLocaleString()})
      </label>}
      {selection && <button className="subtle-button" onClick={() => { onChange(null); }}>Clear opening</button>}
    </div>
    {error && <p role="alert" className="notice error">{error}</p>}
    {available ? <>
      <div className="opening-filter-controls">
        {levels.map(level => <OpeningCombobox key={`${level.depth}-${level.depth ? chosenPath[level.depth - 1].id : 'root'}`}
          label={level.label} selected={level.selected} disabled={loading}
          placeholder={level.depth === 0 ? 'All openings' : level.depth === 1 ? 'All lines' : 'All sublines'}
          options={level.depth === 0 ? [{ id: 'unclassified', label: 'Unclassified', count: facets.unclassified }, ...level.options] : level.options}
          onChange={id => {
            if (id === 'unclassified') onChange({ id: 'unclassified', path: [] });
            else choose(level.options.find(node => node.id === id) ?? (level.depth ? chosenPath[level.depth - 1] : null));
          }} />)}
      </div>
      {selection && <p className="opening-breadcrumb">{selection.id === 'unclassified' ? 'Unclassified games' : chosenPath.map(node => node.label).join(' / ')}
        <span>{selection.id === 'unclassified' ? 'No current named match; includes games not yet enriched or with unreadable moves.' : 'Games reaching this line, including transpositions and sublines.'}</span></p>}
    </> : !loading && !error && <p className="opening-unavailable">Opening names {facets?.supported ? 'have not been added to this archive yet' : 'are unavailable in this archive'}. You can still filter by ECO under More filters.</p>}
  </section>;
}
