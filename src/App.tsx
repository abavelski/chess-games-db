import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, ChevronsUpDown, FolderOpen, Medal, RefreshCw, Search, X } from 'lucide-react';
import { FavouriteButton } from './FavouriteButton';
import { PropertyFilter } from './PropertyFilter';
import { GameReview } from './GameReview';
import { PositionSearchBoard } from './PositionSearchBoard';
import { INITIAL_POSITION_FEN, type PositionSearchSetup } from './position-search-board.mjs';
import { readReviewPreferences } from './EnginePanel';
import { resolveReviewNavigation, type ReviewNavigation } from './review-navigation.mjs';
import { OpeningFilter, type OpeningSelection } from './OpeningFilter';
import type { Catalog, GameDetail, GameRow, Page, PositionSearchCoverage, PositionSearchResult, PositionSearchRow, PropertyKey, SearchFilters } from './types';

const defaultFilters = { yearFrom: '', sort: 'book', favouritesOnly: false, personalOnly: false };
const propertyLabels: Array<[PropertyKey,string]> = [['source','Source'],['sourceType','Source type'],['result','Result'],['studyMarkers','Study markers']];
type Filters = typeof defaultFilters;
const num = (value: number) => new Intl.NumberFormat().format(value);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const gameTitle = (game: GameRow) => `${game.white || 'Unknown'} vs ${game.black || 'Unknown'}`;
const positionHit = (game: GameRow): game is PositionSearchRow => 'match' in game;
interface ReviewSession {
  key: number;
  game: GameDetail;
  navigation: ReviewNavigation | null;
}

function FilterInput({ label, value, onChange, year = false }: {
  label: string; value: string; onChange: (value: string) => void; year?: boolean;
}) {
  return <label className="field"><span>{label}</span><input value={value}
    type={year ? 'number' : 'text'} min={year ? 1 : undefined} max={year ? 9999 : undefined}
    placeholder={year ? 'Any' : 'Any ' + label.toLowerCase()} onChange={event => onChange(event.target.value)} /></label>;
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const catalogPath = useRef(catalog?.path);
  catalogPath.current = catalog?.path;
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [properties, setProperties] = useState<Partial<Record<PropertyKey,string[]>>>({});
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [page, setPage] = useState(1);
  const [openingSelection, setOpeningSelection] = useState<OpeningSelection | null>(null);
  const [results, setResults] = useState<Page<GameRow> | null>(null);
  const [openingTab, setOpeningTab] = useState<'tree' | 'position'>('tree');
  const [positionBoardMounted, setPositionBoardMounted] = useState(false);
  const [positionSetup, setPositionSetup] = useState<PositionSearchSetup>({ initialFen: INITIAL_POSITION_FEN, moves: [] });
  const [includeSourceVariations, setIncludeSourceVariations] = useState(false);
  // Editing the board does not search. Only an explicit Search commits the FEN.
  const [appliedPositionFen, setAppliedPositionFen] = useState<string | null>(null);
  const [positionSearchRevision, setPositionSearchRevision] = useState(0);
  const [positionCoverage, setPositionCoverage] = useState<PositionSearchCoverage | null>(null);
  const [fetching, setFetching] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [gameError, setGameError] = useState<string | null>(null);
  const [openingGame, setOpeningGame] = useState<number | null>(null);
  // A review that initiates search stays mounted (but suspended) so returning
  // restores its exact viewer path, personal editor, focus, scroll and settings.
  const [reviewSessions, setReviewSessions] = useState<ReviewSession[]>([]);
  const [activeReviewKey, setActiveReviewKey] = useState<number | null>(null);
  const [originReviewKey, setOriginReviewKey] = useState<number | null>(null);
  const nextReviewKey = useRef(0);
  const [savingFavourites, setSavingFavourites] = useState<Set<number>>(new Set());
  const pendingFavourites = useRef(new Set<number>());
  const [favouriteError, setFavouriteError] = useState<string | null>(null);
  const [favouriteRevision, setFavouriteRevision] = useState(0);
  const trigger = useRef<HTMLElement | null>(null);
  const scroll = useRef({ x: 0, y: 0 });
  const gameRequest = useRef(0);
  const baseFilters = useMemo<SearchFilters>(() => ({...filters,properties}),[filters,properties,favouriteRevision]);
  const dropdownFilters = useMemo<SearchFilters>(() => ({...baseFilters,openingNodeId:openingSelection?.id}),[baseFilters,openingSelection]);

  const closeReview = useCallback((key: number) => {
    setReviewSessions(previous => previous.filter(session => session.key !== key));
    setActiveReviewKey(null);
    setOriginReviewKey(previous => previous === key ? null : previous);
    requestAnimationFrame(() => {
      window.scrollTo(scroll.current.x, scroll.current.y);
      const target = trigger.current?.isConnected ? trigger.current : document.querySelector<HTMLInputElement>('.favourites-filter input');
      target?.focus({ preventScroll: true });
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
    if (!catalog) return;
    let alive = true;
    setFetching(true); setQueryError(null); setGameError(null);
    const requestFilters = { ...baseFilters, openingNodeId: openingSelection?.id, page, pageSize: 40,
      ...(appliedPositionFen === null ? {} : {scope: includeSourceVariations ? 'includeSourceVariations' as const : 'mainline' as const}) };
    const request = appliedPositionFen === null
      ? window.chessArchive.searchGames(requestFilters)
      : window.chessArchive.searchByPosition(appliedPositionFen, requestFilters);
    request.then(value => { if (alive) {
      setResults(value);
      setPositionCoverage(appliedPositionFen === null ? null : (value as PositionSearchResult).coverage);
      const lastPage = Math.max(1, Math.ceil(value.total / 40));
      if (page > lastPage) setPage(lastPage);
    } })
      .catch(error => { if (alive) setQueryError(errorMessage(error)); })
      .finally(() => { if (alive) setFetching(false); });
    return () => { alive = false; };
  }, [catalog, baseFilters, openingSelection, page, appliedPositionFen, includeSourceVariations, positionSearchRevision]);

  const patchFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters(previous => ({ ...previous, [key]: value })); setPage(1);
  };
  const resetFilters = () => {
    setOpeningSelection(null); setFilters(defaultFilters); setProperties({}); setPage(1);
  };
  const openArchive = async () => {
    setOpening(true); setOpenError(null);
    try {
      const result = await window.chessArchive.openDatabase();
      if (!result.canceled && result.catalog) {
        gameRequest.current++;
        setReviewSessions([]); setActiveReviewKey(null); setOriginReviewKey(null);
        setOpeningGame(null); setGameError(null); setResults(null);
        setAppliedPositionFen(null); setPositionCoverage(null);
        setPositionSetup({ initialFen: INITIAL_POSITION_FEN, moves: [] }); setOpeningTab('tree'); setPositionBoardMounted(false); setIncludeSourceVariations(false);
        resetFilters(); setFavouriteError(null); setCatalog(result.catalog);
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
      const navigation = positionHit(game) && appliedPositionFen !== null
        ? resolveReviewNavigation(detail.pgn, game.match, appliedPositionFen, readReviewPreferences().display.criticalStudy)
        : null;
      const key = ++nextReviewKey.current;
      setReviewSessions(previous => [...previous, { key, game: detail, navigation }]);
      setActiveReviewKey(key);
    } catch (error) { if (request === gameRequest.current) setGameError(errorMessage(error)); }
    finally { if (request === gameRequest.current) setOpeningGame(null); }
  };
  const toggleFavourite = async (game: GameRow) => {
    if (pendingFavourites.current.has(game.id)) return;
    const archivePath = catalog?.path;
    pendingFavourites.current.add(game.id);
    setSavingFavourites(new Set(pendingFavourites.current)); setFavouriteError(null);
    try {
      const favourite = await window.chessArchive.setFavourite(game.id, !game.favourite);
      if (archivePath !== catalogPath.current) return;
      setResults(previous => previous && ({ ...previous, rows: previous.rows.map(row => row.id === game.id ? { ...row, favourite: Number(favourite) } : row) }));
      setReviewSessions(previous => previous.map(session => session.game.id === game.id
        ? { ...session, game: { ...session.game, favourite: Number(favourite) } } : session));
      setFavouriteRevision(value => value + 1);
    } catch (error) { if (archivePath === catalogPath.current) setFavouriteError('Could not save favourite: ' + errorMessage(error)); }
    finally {
      pendingFavourites.current.delete(game.id);
      setSavingFavourites(new Set(pendingFavourites.current));
    }
  };
  const findFromReview = (key: number, fen: string) => {
    if (!catalog || !reviewSessions.some(session => session.key === key)) return;
    // Compare with the same archive and filters already active in the browser.
    // Drop older search origins, but never remount the selected review session.
    setReviewSessions(previous => previous.filter(session => session.key === key));
    setOriginReviewKey(key);
    setActiveReviewKey(null);
    setAppliedPositionFen(fen); setPositionSearchRevision(value => value + 1);
    setPositionCoverage(null); setResults(null); setIncludeSourceVariations(false);
    setPositionSetup({ initialFen: fen, moves: [] });
    setOpeningTab('position'); setPositionBoardMounted(true); setPage(1);
    requestAnimationFrame(() => window.scrollTo(0, 0));
  };
  const originReview = reviewSessions.find(session => session.key === originReviewKey);
  const returnToOrigin = () => {
    if (!originReview) return;
    setActiveReviewKey(originReview.key);
    requestAnimationFrame(() => window.scrollTo(0, 0));
  };
  const total = results?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 40));
  const start = total ? ((results?.page ?? 1) - 1) * 40 + 1 : 0;
  const end = Math.min((results?.page ?? 1) * 40, total);
  const hasFilters = !!(Object.values(properties).some(values=>values?.length) || openingSelection || Object.entries(filters).some(([key, value]) => value !== defaultFilters[key as keyof Filters]));
  const searchPosition = (fen: string) => {
    setAppliedPositionFen(fen); setPositionSearchRevision(value => value + 1); setPage(1);
  };
  const clearPositionSearch = () => {
    setAppliedPositionFen(null); setPositionCoverage(null); setPage(1);
  };
  const toggleSourceVariations = (enabled: boolean) => {
    setIncludeSourceVariations(enabled); setPage(1);
    if (appliedPositionFen !== null) { setResults(null); setPositionCoverage(null); }
  };
  const coverageIssue = appliedPositionFen !== null && positionCoverage !== null && !positionCoverage.isComplete;
  const coverageMessage = positionCoverage?.status === 'unavailable'
    ? 'This archive has no position index. On a backup, run npm run positions -- init --database PATH, then npm run positions -- build --database PATH.'
    : positionCoverage?.status === 'incompatible'
      ? 'This archive has an incompatible position index. Use a compatible archive or restore a backup.'
      : positionCoverage?.scope === 'includeSourceVariations'
        ? `Annotated variation coverage incomplete: ${num(positionCoverage.complete)} of ${num(positionCoverage.total)} visible games fully indexed; ${num(positionCoverage.mainlineOnly)} have only verified mainlines (or invalid source variations), ${num(positionCoverage.unindexed)} unindexed, ${num(positionCoverage.building + positionCoverage.partial)} in progress, ${num(positionCoverage.stale)} stale, ${num(positionCoverage.unsupported)} unsupported, ${num(positionCoverage.invalid)} invalid. Listed matches are verified but may omit author variations. On a backup, run npm run positions -- build --database PATH --include-variations.`
        : positionCoverage ? `Position index incomplete: ${num(positionCoverage.complete)} of ${num(positionCoverage.total)} visible games indexed; ${num(positionCoverage.unindexed)} not indexed, ${num(positionCoverage.building + positionCoverage.partial)} in progress, ${num(positionCoverage.stale)} stale, ${num(positionCoverage.unsupported)} unsupported, ${num(positionCoverage.invalid)} invalid. Results below include only searchable games.` : '';

  return <>
    <div hidden={activeReviewKey !== null}>
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
            <div className="game-filters-grid">
              {propertyLabels.map(([property,label])=><PropertyFilter key={property} property={property} label={label} selected={properties[property]??[]} filters={dropdownFilters} onChange={values=>{setProperties(previous=>({...previous,[property]:values}));setPage(1);}} />)}
              <FilterInput label="Year from" year value={filters.yearFrom} onChange={value => patchFilter('yearFrom', value)} />
            </div>
            <div className="extra-game-filters">
              <label className="favourites-filter"><input type="checkbox" checked={filters.favouritesOnly} onChange={event => patchFilter('favouritesOnly', event.target.checked)} />Favourites only</label>
              <label className="personal-filter favourites-filter"><input type="checkbox" checked={filters.personalOnly} onChange={event => patchFilter('personalOnly', event.target.checked)} />My lines or comments</label>
              {hasFilters && <button className="subtle-button" onClick={resetFilters}><X size={14} />Clear filters</button>}

            </div>
          </section>
          {originReview && <section className="review-search-return" aria-label="Return to originating review">
            <button type="button" className="secondary-button" onClick={returnToOrigin}>
              <ChevronLeft size={16} />Return to reviewed game
            </button>
            <span>{gameTitle(originReview.game)} · Original review and analysis preserved</span>
            {appliedPositionFen && <span className="review-search-exact">Searching reviewed FEN: <code>{appliedPositionFen}</code></span>}
          </section>}
          <section className="opening-search" aria-label="Search by opening">
            <div className="opening-search-tabs" role="tablist" aria-label="Opening search method">
              {(['tree', 'position'] as const).map(tab => <button key={tab} type="button" role="tab"
                id={`opening-${tab}-tab`} aria-controls={`opening-${tab}-panel`} aria-selected={openingTab === tab}
                tabIndex={openingTab === tab ? 0 : -1}
                onClick={() => { setOpeningTab(tab); if (tab === 'position') setPositionBoardMounted(true); }}
                onKeyDown={event => {
                  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    const next = event.key === 'Home' ? 'tree' : event.key === 'End' ? 'position' : openingTab === 'tree' ? 'position' : 'tree';
                    setOpeningTab(next); if (next === 'position') setPositionBoardMounted(true);
                    document.getElementById(`opening-${next}-tab`)?.focus();
                  }
                }}>{tab === 'tree' ? 'Opening tree' : 'Search by position'}{(tab === 'tree' ? openingSelection : appliedPositionFen) && <span className="opening-tab-active"> (Active)</span>}</button>)}
            </div>
            <div id="opening-tree-panel" role="tabpanel" aria-labelledby="opening-tree-tab" hidden={openingTab !== 'tree'}>
              <OpeningFilter key={catalog.path} filters={baseFilters} selection={openingSelection} onChange={value => { setOpeningSelection(value); setPage(1); }} />
            </div>
            <div id="opening-position-panel" role="tabpanel" aria-labelledby="opening-position-tab" hidden={openingTab !== 'position'}>

              <section className="position-search-section" aria-label="Position search">
                {appliedPositionFen && <p className="position-search-active">Exact position search active{includeSourceVariations ? ' (Annotated variations included)' : ''}</p>}
                {positionBoardMounted && <div id="position-search-content">
                   <label className="position-variation-toggle"><input type="checkbox" checked={includeSourceVariations}
                     onChange={event => toggleSourceVariations(event.target.checked)} />Include annotated variations</label>
                   <p className="position-variation-description">Search author-written alternatives as well as moves played in the game. Variation-only results are identified below.</p>
                  <PositionSearchBoard key={catalog.path} setup={positionSetup} onSetupChange={setPositionSetup} onSearch={searchPosition}
                    onClear={clearPositionSearch} activeFen={appliedPositionFen} />
                </div>}
              </section>
            </div>
          </section>
          {coverageIssue && !fetching && !queryError && <div className="notice position-coverage-notice" role="status"><AlertCircle size={18} aria-hidden="true" /><span>{coverageMessage}</span></div>}
          <div className="results-titlebar"><div><h2>{appliedPositionFen ? 'Games reaching this position' : 'Games'}</h2><span role="status">{fetching ? 'Searching…' : `${num(total)} ${total === 1 ? 'game' : 'games'}`}</span></div>
            <label className="sort-box"><ChevronsUpDown size={15} /><select aria-label="Sort games" value={filters.sort} onChange={event => patchFilter('sort', event.target.value)}>
              <option value="book">Source order</option><option value="year_desc">Year · newest</option><option value="year_asc">Year · oldest</option>
              <option value="white">White player A–Z</option><option value="source">Source title A–Z</option><option value="newest">Newest added</option>
            </select></label>
          </div>
          {favouriteError && <div role="alert" className="notice error"><AlertCircle size={17} />{favouriteError}</div>}
          {gameError && <div role="alert" className="notice error"><AlertCircle size={17} />{gameError}</div>}
          {openingGame !== null && <p className="game-opening" role="status">Opening game…</p>}
          <section className="results-panel game-results" aria-label="Games" aria-busy={fetching}>
            {queryError ? <div className="empty-results" role="alert"><AlertCircle size={28} /><h3>Unable to search games</h3><p>{queryError}</p></div>
              : fetching && !results ? <div className="empty-results"><RefreshCw className="spin" size={26} /><p>Loading games…</p></div>
              : !results?.rows.length ? <div className="empty-results"><Search size={28} />
                <h3>{coverageIssue ? 'Position index not ready' : appliedPositionFen ? 'No games reached this position' : 'No games found'}</h3>
                <p>{coverageIssue ? 'Matches can be missing until the archive index is complete. See index coverage above.' : appliedPositionFen ? 'No indexed games match this exact board and your current filters.' : 'Try another source or adjust your filters.'}</p>
                {hasFilters && <button className="secondary-button" onClick={resetFilters}>Clear filters</button>}
                {appliedPositionFen && <button className="secondary-button" onClick={clearPositionSearch}>Clear position search</button>}
              </div>
              : <div className="results-list">{results.rows.map(game => <div key={game.id} className="game-result-row"><button className="result-item" disabled={openingGame !== null}
                onClick={event => void openGame(game, event.currentTarget)}>
                <span className="game-piece" aria-hidden="true">♟</span>
                <span className="item-main"><strong>{gameTitle(game)}</strong>
                  {!!game.has_critical_positions && <span className="game-critical-badge">◆ {game.critical_position_count} critical {game.critical_position_count === 1 ? 'position' : 'positions'}</span>}
                  {!!game.has_medals && <span className="game-medal-badge"><Medal size={13} aria-hidden="true" /> {game.medal_count} {game.medal_count === 1 ? 'medal' : 'medals'}</span>}
                  <span className="item-small">{[game.event, game.year].filter(Boolean).join(' · ') || 'Event and date unavailable'}</span>
                  {positionHit(game) && <span className="position-match-label">{game.match.isMainline ? "Played game" : "Author’s annotation · source variation"} · {game.match.ply === 0 ? "Starting position" : `Ply ${game.match.ply}`}</span>}
                  {(game.opening?.name || catalog.capabilities?.openings) && <span className="game-opening-name" title={game.opening?.name ?? undefined}>{game.opening?.name ? `${game.opening.name} · ${game.opening.eco}` : game.opening?.status === 'unenriched' ? 'Opening not enriched' : 'Unclassified opening'}</span>}
                  <small>{game.source_title} · {game.completeness === 'unknown' ? 'Completeness unknown' : game.completeness}{game.annotator ? ` · Annotated by ${game.annotator}` : ''}</small></span>
                <span className="item-extra"><span className="result-val">{game.result || '—'}</span><ChevronRight size={17} /></span>
              </button><FavouriteButton favourite={!!game.favourite} disabled={savingFavourites.has(game.id)} onClick={() => void toggleFavourite(game)} label={gameTitle(game)} /></div>)}</div>}
            <div className="pagination"><span>{num(start)}–{num(end)} of {num(total)}</span><div>
              <button className="page-button" aria-label="Previous page" disabled={page <= 1 || fetching} onClick={() => setPage(value => value - 1)}><ChevronLeft size={17} /></button>
              <span>Page {page} of {pageCount}</span><button className="page-button" aria-label="Next page" disabled={page >= pageCount || fetching} onClick={() => setPage(value => value + 1)}><ChevronRight size={17} /></button>
            </div></div>
          </section>
        </>}
      </main>
    </div>
    {reviewSessions.map(session => <div key={session.key} className="review-session" hidden={activeReviewKey !== session.key}>
      <GameReview game={session.game} onPersonalSaved={() => setFavouriteRevision(value => value + 1)}
        initialPath={session.navigation?.path ?? ''} matchedPositionKey={session.navigation?.positionKey ?? null}
        navigationNotice={session.navigation?.notice ?? null} positionSearchNavigation={!!session.navigation}
        suspended={activeReviewKey !== session.key} onFindPosition={fen => findFromReview(session.key, fen)}
        onClose={() => closeReview(session.key)} onToggleFavourite={() => void toggleFavourite(session.game)}
        savingFavourite={savingFavourites.has(session.game.id)} favouriteError={favouriteError} />
    </div>)}

  </>;
}
