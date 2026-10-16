import { useEffect, useId, useState } from 'react';
import type { OpeningFacets, OpeningNode, SearchFilters } from './types';

export interface OpeningSelection { id: string; path: OpeningNode[] }

export function OpeningFilter({ filters, selection, onChange }: {
  filters: SearchFilters; selection: OpeningSelection | null; onChange: (value: OpeningSelection | null) => void;
}) {
  const [facets, setFacets] = useState<OpeningFacets | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const resultsId = useId();
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
    setSearch('');
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
  const term = search.trim().toLocaleLowerCase();
  const found = term ? (facets?.nodes ?? []).filter(node => node.path.join(' / ').toLocaleLowerCase().includes(term))
    .sort((a, b) => Number(b.label.toLocaleLowerCase().includes(term)) - Number(a.label.toLocaleLowerCase().includes(term))
      || a.path.length - b.path.length || a.path.join(' / ').localeCompare(b.path.join(' / '))) : [];
  const available = !!facets?.revision;
  return <section className="opening-filter" aria-label="Opening filters" aria-busy={loading}>
    <div className="opening-filter-heading"><strong>Opening</strong>
      <span role="status">{loading ? 'Updating openings…' : available ? `${facets.classified.toLocaleString()} of ${facets.total.toLocaleString()} games classified` : ''}</span>
      {selection && <button className="subtle-button" onClick={() => { setSearch(''); onChange(null); }}>Clear opening</button>}
    </div>
    {error && <p role="alert" className="notice error">{error}</p>}
    {available ? <>
      <div className="opening-filter-controls">
        <label className="field opening-name-search"><span>Find opening or variation</span>
          <input type="search" aria-controls={resultsId} value={search} placeholder="e.g. Sicilian, Najdorf, English Attack"
            onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setSearch(''); }} /></label>
        {levels.map(level => <label className="field" key={level.label}><span>{level.label}</span>
          <select value={level.selected} disabled={loading} onChange={event => {
            if (event.target.value === 'unclassified') { setSearch(''); onChange({ id: 'unclassified', path: [] }); }
            else choose(level.options.find(node => node.id === event.target.value) ?? (level.depth ? chosenPath[level.depth - 1] : null));
          }}>
            <option value="">{level.depth === 0 ? 'All openings' : level.depth === 1 ? 'All lines' : 'All sublines'}</option>
            {level.depth === 0 && <option value="unclassified">Unclassified ({facets.unclassified.toLocaleString()})</option>}
            {level.options.map(node => <option key={node.id} value={node.id}>{node.label} ({node.count.toLocaleString()})</option>)}
          </select></label>)}
      </div>
      {search.trim() && <div id={resultsId} className="opening-search-results" aria-label="Matching openings">
        {found.slice(0, 30).map(node => <button key={node.id} disabled={loading} onClick={() => choose(node)}>
          <span>{node.path.join(' / ')}</span><small>{node.count.toLocaleString()} games</small></button>)}
        {!found.length && <p>No openings match this name within the current filters.</p>}
        {found.length > 30 && <p>Showing 30 of {found.length} matches. Refine the name to find a specific line.</p>}
      </div>}
      {selection && <p className="opening-breadcrumb">{selection.id === 'unclassified' ? 'Unclassified games' : chosenPath.map(node => node.label).join(' / ')}
        <span>{selection.id === 'unclassified' ? 'No current named match; includes games not yet enriched or with unreadable moves.' : 'Games reaching this line, including transpositions and sublines.'}</span></p>}
    </> : !loading && !error && <p className="opening-unavailable">Opening names {facets?.supported ? 'have not been added to this archive yet' : 'are unavailable in this archive'}. You can still filter by ECO under More filters.</p>}
  </section>;
}
