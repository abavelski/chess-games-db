import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, ChevronsUpDown, FolderOpen, Medal, RefreshCw, Search, X } from 'lucide-react';
import { PropertyFilter } from './PropertyFilter';
import { GameReview } from './GameReview';
import { OpeningFilter, type OpeningSelection } from './OpeningFilter';
import type { Catalog, GameDetail, GameRow, Page, PropertyKey, SearchFilters } from './types';

const defaultFilters = { yearFrom: '', yearTo: '', sort: 'book' };
const propertyLabels: Array<[PropertyKey,string]> = [['source','Source'],['sourceSection','Source section'],['sourceType','Source type'],['players','Either player'],['white','White player'],['black','Black player'],['annotators','Annotator'],['event','Event'],['site','Site'],['year','Year'],['result','Result'],['completeness','Completeness'],['annotations','Annotations'],['medals','Medals'],['criticalPositions','Critical positions'],['studyMarkers','Study markers'],['eco','Source ECO']];
type Filters = typeof defaultFilters;
const num = (value: number) => new Intl.NumberFormat().format(value);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const gameTitle = (game: GameRow) => `${game.white || 'Unknown'} vs ${game.black || 'Unknown'}`;

function FilterInput({ label, value, onChange, year = false }: {
  label: string; value: string; onChange: (value: string) => void; year?: boolean;
}) {
  return <label className="field"><span>{label}</span><input value={value}
    type={year ? 'number' : 'text'} min={year ? 1 : undefined} max={year ? 9999 : undefined}
    placeholder={year ? 'Any' : 'Any ' + label.toLowerCase()} onChange={event => onChange(event.target.value)} /></label>;
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [properties, setProperties] = useState<Partial<Record<PropertyKey,string[]>>>({});
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [page, setPage] = useState(1);
  const [openingSelection, setOpeningSelection] = useState<OpeningSelection | null>(null);
  const [results, setResults] = useState<Page<GameRow> | null>(null);
  const [fetching, setFetching] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [gameError, setGameError] = useState<string | null>(null);
  const [openingGame, setOpeningGame] = useState<number | null>(null);
  const [review, setReview] = useState<GameDetail | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const scroll = useRef({ x: 0, y: 0 });
  const gameRequest = useRef(0);
  const baseFilters = useMemo<SearchFilters>(() => ({...filters,properties,search:debouncedSearch}),[filters,properties,debouncedSearch]);
  const dropdownFilters = useMemo<SearchFilters>(() => ({...baseFilters,openingNodeId:openingSelection?.id}),[baseFilters,openingSelection]);

  const closeReview = useCallback(() => {
    setReview(null);
    requestAnimationFrame(() => {
      window.scrollTo(scroll.current.x, scroll.current.y);
      trigger.current?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (!window.chessArchive) {
      setOpenError('Open this app through Electron with npm run dev.');
      return;
    }
    let alive = true;
    window.chessArchive.getCatalog().then(value => { if (alive) setCatalog(value); })
      .catch(error => { if (alive) setOpenError(errorMessage(error)); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!catalog) return;
    let alive = true;
    setFetching(true); setQueryError(null); setGameError(null);
    window.chessArchive.searchGames({
      ...baseFilters, openingNodeId: openingSelection?.id, page, pageSize: 40,
    }).then(value => { if (alive) setResults(value); })
      .catch(error => { if (alive) setQueryError(errorMessage(error)); })
      .finally(() => { if (alive) setFetching(false); });
    return () => { alive = false; };
  }, [catalog, baseFilters, openingSelection, page]);

  const patchFilter = (key: keyof Filters, value: string) => {
    setFilters(previous => ({ ...previous, [key]: value })); setPage(1);
  };
  const resetFilters = () => {
    setOpeningSelection(null); setFilters(defaultFilters); setProperties({}); setSearch(''); setDebouncedSearch(''); setPage(1);
  };
  const openArchive = async () => {
    setOpening(true); setOpenError(null);
    try {
      const result = await window.chessArchive.openDatabase();
      if (!result.canceled && result.catalog) {
        gameRequest.current++;
        setOpeningGame(null); setGameError(null); setResults(null);
        resetFilters(); setCatalog(result.catalog);
      }
    } catch (error) { setOpenError(errorMessage(error)); }
    finally { setOpening(false); }
  };
  const openGame = async (game: GameRow, element: HTMLButtonElement) => {
    const request = ++gameRequest.current;
    trigger.current = element;
    scroll.current = { x: window.scrollX, y: window.scrollY };
    setOpeningGame(game.id); setGameError(null);
    try {
      const detail = await window.chessArchive.getGame(game.id);
      if (request !== gameRequest.current) return;
      if (!detail) throw new Error('This game is no longer available in the archive.');
      setReview(detail);
    } catch (error) { if (request === gameRequest.current) setGameError(errorMessage(error)); }
    finally { if (request === gameRequest.current) setOpeningGame(null); }
  };
  const total = results?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 40));
  const start = total ? ((results?.page ?? 1) - 1) * 40 + 1 : 0;
  const end = Math.min((results?.page ?? 1) * 40, total);
  const hasFilters = !!(search || Object.values(properties).some(values=>values?.length) || openingSelection || Object.entries(filters).some(([key, value]) => value !== defaultFilters[key as keyof Filters]));

  return <>
    <div hidden={!!review}>
      <main className="game-browser">
        <header className="browser-header">
          <div className="browser-brand"><span aria-hidden="true">♞</span><div><h1>Games</h1><p>Browse a game. Explore every move.</p></div></div>
          <div className="browser-archive">
            {catalog && <span title={catalog.path}>{catalog.path.split(/[\\/]/).pop()}</span>}
            <button className="secondary-button" onClick={openArchive} disabled={opening || !window.chessArchive}>
              <FolderOpen size={16} /> {opening ? 'Opening…' : catalog ? 'Change database' : 'Open database'}
            </button>
          </div>
        </header>
        {openError && <div role="alert" className="notice error"><AlertCircle size={17} />{openError}</div>}
        {!catalog ? <section className="welcome">
          <div className="welcome-symbol" aria-hidden="true">♜</div><h2>Open your games.</h2>
          <p>Choose a local chess archive to browse and review annotated games.</p>
          <button className="primary-button" onClick={openArchive} disabled={opening || !window.chessArchive}><FolderOpen size={17} />Choose database</button>
        </section> : <>
          <section className="browser-filters" aria-label="Filter games">
            <label className="search-box"><Search size={18} /><input aria-label="Search games" value={search}
              placeholder="Search games…" onChange={event => { setSearch(event.target.value); setPage(1); }} />
              {search && <button aria-label="Clear search" onClick={() => { setSearch(''); setPage(1); }}><X size={15} /></button>}
            </label>
            <div className="game-filters-grid">
              {propertyLabels.map(([property,label])=><PropertyFilter key={property} property={property} label={label} selected={properties[property]??[]} filters={dropdownFilters} onChange={values=>{setProperties(previous=>({...previous,[property]:values}));setPage(1);}} />)}
              <div className="year-filters"><FilterInput label="Year from" year value={filters.yearFrom} onChange={value => patchFilter('yearFrom', value)} />
                <FilterInput label="Year to" year value={filters.yearTo} onChange={value => patchFilter('yearTo', value)} /></div>
            </div>
            <div className="extra-game-filters">
              {hasFilters && <button className="subtle-button" onClick={resetFilters}><X size={14} />Clear filters</button>}

            </div>
          </section>
          <OpeningFilter key={catalog.path} filters={baseFilters} selection={openingSelection} onChange={value => { setOpeningSelection(value); setPage(1); }} />
          <div className="results-titlebar"><div><h2>Games</h2><span role="status">{fetching ? 'Searching…' : `${num(total)} ${total === 1 ? 'game' : 'games'}`}</span></div>
            <label className="sort-box"><ChevronsUpDown size={15} /><select aria-label="Sort games" value={filters.sort} onChange={event => patchFilter('sort', event.target.value)}>
              <option value="book">Source order</option><option value="year_desc">Year · newest</option><option value="year_asc">Year · oldest</option>
              <option value="white">White player A–Z</option><option value="source">Source title A–Z</option><option value="newest">Newest added</option>
            </select></label>
          </div>
          {gameError && <div role="alert" className="notice error"><AlertCircle size={17} />{gameError}</div>}
          {openingGame !== null && <p className="game-opening" role="status">Opening game…</p>}
          <section className="results-panel game-results" aria-label="Games" aria-busy={fetching}>
            {queryError ? <div className="empty-results" role="alert"><AlertCircle size={28} /><h3>Unable to search games</h3><p>{queryError}</p></div>
              : fetching ? <div className="empty-results"><RefreshCw className="spin" size={26} /><p>Loading games…</p></div>
              : !results?.rows.length ? <div className="empty-results"><Search size={28} /><h3>No games found</h3><p>Try another source or adjust your filters.</p><button className="secondary-button" onClick={resetFilters}>Clear filters</button></div>
              : <div className="results-list">{results.rows.map(game => <button key={game.id} className="result-item" disabled={openingGame !== null}
                onClick={event => void openGame(game, event.currentTarget)}>
                <span className="game-piece" aria-hidden="true">♟</span>
                <span className="item-main"><strong>{gameTitle(game)}</strong>
                  {!!game.has_critical_positions && <span className="game-critical-badge">◆ {game.critical_position_count} critical {game.critical_position_count === 1 ? 'position' : 'positions'}</span>}
                  {!!game.has_medals && <span className="game-medal-badge"><Medal size={13} aria-hidden="true" /> {game.medal_count} {game.medal_count === 1 ? 'medal' : 'medals'}</span>}
                  <span className="item-small">{[game.event, game.year, game.eco && game.opening?.eco && game.eco !== game.opening.eco ? `Source ECO ${game.eco}` : game.eco].filter(Boolean).join(' · ') || 'Event and date unavailable'}</span>
                  {(game.opening?.name || catalog.capabilities?.openings) && <span className="game-opening-name" title={game.opening?.name ?? undefined}>{game.opening?.name ? `${game.opening.name} · ${game.opening.eco}` : game.opening?.status === 'unenriched' ? 'Opening not enriched' : 'Unclassified opening'}</span>}
                  <small>{game.source_title} · {game.completeness === 'unknown' ? 'Completeness unknown' : game.completeness}{game.annotator ? ` · Annotated by ${game.annotator}` : ''}</small></span>
                <span className="item-extra"><span className="result-val">{game.result || '—'}</span><ChevronRight size={17} /></span>
              </button>)}</div>}
            <div className="pagination"><span>{num(start)}–{num(end)} of {num(total)}</span><div>
              <button className="page-button" aria-label="Previous page" disabled={page <= 1 || fetching} onClick={() => setPage(value => value - 1)}><ChevronLeft size={17} /></button>
              <span>Page {page} of {pageCount}</span><button className="page-button" aria-label="Next page" disabled={page >= pageCount || fetching} onClick={() => setPage(value => value + 1)}><ChevronRight size={17} /></button>
            </div></div>
          </section>
        </>}
      </main>
    </div>
    {review && <GameReview game={review} initialPath="" onClose={closeReview} />}

  </>;
}
