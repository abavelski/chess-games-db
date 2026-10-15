import { useEffect, useState } from 'react';
import {
  BookOpen, Library, Target, Flag, FileText, Layers3, Database, FolderOpen,
  Search, SlidersHorizontal, ChevronLeft, ChevronRight, X, RefreshCw,
  Copy, AlertCircle, CheckCircle2, ChevronsUpDown, BookMarked, ListFilter,
  ArrowRight, Hash, PanelRightClose, PanelRightOpen,
} from 'lucide-react';
import { PgnBoard } from './PgnBoard';
import type { Catalog, GameRow, GameDetail, RecordRow, RecordDetail, Page, SearchFilters, Tab } from './types';

type Filters = {
  white: string; black: string; eco: string; event: string; annotator: string;
  yearFrom: string; yearTo: string; result: string; training: string;
  deleted: string; sort: string; recordType: string; status: string;
};
const defaultFilters: Filters = {
  white: '', black: '', eco: '', event: '', annotator: '',
  yearFrom: '', yearTo: '', result: 'all', training: 'all', deleted: 'active',
  sort: 'newest', recordType: 'all', status: 'all',
};
const tabs = [
  { key: 'all', label: 'All entries', icon: Library, subtitle: 'Explore the complete chess book archive' },
  { key: 'game', label: 'Games', icon: BookOpen, subtitle: 'Annotated master games and full scores' },
  { key: 'position', label: 'Positions', icon: Target, subtitle: 'Start from a position or study a puzzle' },
  { key: 'line', label: 'Lines & variations', icon: Layers3, subtitle: 'Opening lines, examples and fragments' },
  { key: 'training', label: 'Training', icon: Flag, subtitle: 'Practice material flagged in the source books' },
  { key: 'text', label: 'Book texts', icon: FileText, subtitle: 'Explanations and instructional passages' },
  { key: 'records', label: 'Source records', icon: Database, subtitle: 'Original extraction records and provenance' },
] as const;
const num = (n: number) => new Intl.NumberFormat().format(n);
const pretty = (value: string | null | undefined) => {
  if (!value) return '—';
  try { return JSON.stringify(JSON.parse(value), null, 2); }
  catch { return value; }
};
const displayName = (g: GameRow) => {
  if (g.record_kind === 'text') return g.event || g.source_game_key || 'Book commentary';
  if (g.white || g.black) return (g.white || 'Unknown') + '  vs  ' + (g.black || 'Unknown');
  if (g.record_kind === 'position') return 'Study position';
  if (g.record_kind === 'line') return 'Study line';
  return 'Untitled game';
};
const kindName = (kind: string) => { const names: Record<string, string> = { game: 'Game', position: 'Position', line: 'Line', text: 'Text' }; return names[kind] || kind; };
const errorMessage = (e: unknown) => e instanceof Error ? e.message : String(e);

function FilterInput({ label, value, placeholder, onChange }: {
  label: string; value: string; placeholder?: string; onChange: (v: string) => void;
}) {
  return <label className="field"><span>{label}</span>
    <input value={value} placeholder={placeholder || label} onChange={e => onChange(e.target.value)} />
  </label>;
}

function SelectInput({ label, value, options, onChange }: {
  label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void;
}) {
  return <label className="field"><span>{label}</span>
    <select value={value} onChange={e => onChange(e.target.value)}>
      {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select>
  </label>;
}

function DetailMeta({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="detail-meta"><dt>{label}</dt><dd>{value === null || value === undefined || value === '' ? '—' : value}</dd></div>;
}

function GamePanel({ game, onClose }: { game: GameDetail; onClose: () => void }) {
  const [mode, setMode] = useState<'board' | 'pgn' | 'metadata'>(game.record_kind === 'text' ? 'pgn' : 'board');
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(game.pgn); setCopied(true); }
    catch { setCopied(false); }
  };
  return <div className="details-content">
    <div className="details-top">
      <div className="eyebrow">ARCHIVE ENTRY  <span>#{game.id}</span></div>
      <button className="icon-button panel-close" onClick={onClose} title="Close details"><X size={18} /></button>
    </div>
    <h2 className="detail-title">{displayName(game)}</h2>
    <div className="entry-tags">
      <span className={'pill kind-' + game.record_kind}>{kindName(game.record_kind)}</span>
      {game.is_training === 1 && <span className="pill training">Training</span>}
      {game.is_deleted === 1 && <span className="pill deleted">Source deleted</span>}
      {game.eco && <span className="pill neutral">{game.eco}</span>}
      {game.result && <span className="pill neutral">{game.result}</span>}
    </div>
    <div className="detail-source"><BookMarked size={16} /> {game.source_title}</div>
    <div className="detail-tabs" role="tablist" aria-label="Entry view">
      {(['board', 'pgn', 'metadata'] as const).map(view => (
        <button key={view} role="tab" aria-selected={mode === view}
          className={mode === view ? 'active' : ''} onClick={() => setMode(view)}>
          {view === 'pgn' ? 'PGN / text' : view === 'board' ? 'Board' : 'Metadata'}
        </button>
      ))}
    </div>
    {mode === 'board' && <div className="board-view">
      <PgnBoard pgn={game.pgn} />
      <p className="hint">Use the move list or board controls to step through the annotated game and variations.</p>
      {game.start_fen && <div className="fen"><span>Starting FEN</span><code>{game.start_fen}</code></div>}
    </div>}
    {mode === 'pgn' && <div className="raw-view">
      <div className="raw-top"><span>Original decompressed PGN</span>
        <button className="subtle-button" onClick={copy}><Copy size={14} /> {copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre className="text-dump">{game.pgn}</pre>
    </div>}
    {mode === 'metadata' && <div className="metadata-view">
      <dl className="detail-grid">
        <DetailMeta label="Book" value={game.source_title} />
        <DetailMeta label="Author" value={game.source_author} />
        <DetailMeta label="White" value={game.white} />
        <DetailMeta label="Black" value={game.black} />
        <DetailMeta label="Event" value={game.event} />
        <DetailMeta label="Site" value={game.site} />
        <DetailMeta label="Date" value={game.date} />
        <DetailMeta label="Year" value={game.year} />
        <DetailMeta label="ECO" value={game.eco} />
        <DetailMeta label="Result" value={game.result} />
        <DetailMeta label="Annotator" value={game.annotator} />
        <DetailMeta label="Game type" value={game.game_type} />
        <DetailMeta label="Training magnitude" value={game.training_magnitude} />
        <DetailMeta label="Source key" value={game.source_game_key} />
      </dl>
      <h3>Original PGN headers</h3><pre className="json-block">{pretty(game.headers_json)}</pre>
      <h3>Additional metadata</h3><pre className="json-block">{pretty(game.extras_json)}</pre>
      <h3>SHA-256</h3><code className="hash">{game.pgn_sha256}</code>
    </div>}
  </div>;
}

function RecordPanel({ record, onClose }: { record: RecordDetail; onClose: () => void }) {
  return <div className="details-content">
    <div className="details-top">
      <div className="eyebrow">SOURCE RECORD  <span>#{record.id}</span></div>
      <button className="icon-button panel-close" onClick={onClose} title="Close details"><X size={18} /></button>
    </div>
    <h2 className="detail-title">{record.source_record_key}</h2>
    <div className="entry-tags">
      <span className="pill neutral">{record.record_type}</span>
      <span className={'pill ' + (record.status === 'failed' ? 'deleted' : 'training')}>
        {record.status === 'failed' ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
        {record.status}
      </span>
    </div>
    <div className="detail-source"><BookMarked size={16} /> {record.source_title}</div>
    <h3>Extraction information</h3>
    <dl className="detail-grid">
      <DetailMeta label="Source" value={record.source_title} />
      <DetailMeta label="Type" value={record.record_type} />
      <DetailMeta label="Status" value={record.status} />
      <DetailMeta label="Move bytes" value={num(record.raw_moves_size)} />
      <DetailMeta label="Annotation bytes" value={num(record.raw_annotations_size)} />
      <DetailMeta label="Updated" value={record.updated_at} />
    </dl>
    <h3>Extraction metadata</h3><pre className="json-block">{pretty(record.metadata_json)}</pre>
    <h3>Original move bytes (UTF-8 preview)</h3>
    {record.raw_preview
      ? <pre className="text-dump">{record.raw_preview}</pre>
      : <p className="hint">No valid UTF-8 preview is available. The original binary record is retained in SQLite.</p>}
  </div>;
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters] = useState<Filters>({ ...defaultFilters });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<Page<GameRow> | Page<RecordRow> | null>(null);
  const [fetching, setFetching] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<GameDetail | RecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    if (!window.chessArchive) {
      setOpenError('Open this interface through Electron (npm run dev), not in a standalone web browser.');
      return;
    }
    window.chessArchive.getCatalog().then(setCatalog).catch(e => setOpenError(errorMessage(e)));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const patchFilter = (key: keyof Filters, value: string) => {
    setFilters(old => ({ ...old, [key]: value }));
    setPage(1);
  };
  const chooseTab = (next: Tab) => {
    setTab(next); setPage(1); setSelectedId(null); setDetail(null); setPanelOpen(true);
  };
  const chooseSource = (id: number | null) => {
    setSourceId(id); setPage(1); setSelectedId(null); setDetail(null);
  };

  const openArchive = async () => {
    setOpening(true);
    setOpenError(null);
    try {
      const result = await window.chessArchive.openDatabase();
      if (!result.canceled && result.catalog) {
        setCatalog(result.catalog);
        setSourceId(null); setSelectedId(null); setDetail(null); setResults(null); setPage(1);
      }
    } catch (e) { setOpenError(errorMessage(e)); }
    finally { setOpening(false); }
  };

  useEffect(() => {
    if (!catalog) return;
    let alive = true;
    setFetching(true); setQueryError(null); setResults(null);
    const query: SearchFilters = {
      search: debouncedSearch, sourceId, page, pageSize: 40,
      ...filters,
      kind: ['game', 'position', 'line', 'text'].includes(tab) ? tab : 'all',
      training: tab === 'training' ? 'yes' : filters.training,
    };
    const operation = tab === 'records'
      ? window.chessArchive.searchRecords(query)
      : window.chessArchive.searchGames(query);
    operation.then(data => {
      if (!alive) return;
      setResults(data);
      setSelectedId(old => data.rows.some(row => row.id === old) ? old : data.rows[0]?.id ?? null);
    }).catch(e => { if (alive) setQueryError(errorMessage(e)); })
      .finally(() => { if (alive) setFetching(false); });
    return () => { alive = false; };
  }, [catalog, tab, sourceId, page, filters, debouncedSearch]);

  useEffect(() => {
    if (!catalog || selectedId === null) { setDetail(null); return; }
    let alive = true;
    setDetail(null); setDetailError(null); setDetailLoading(true);
    const request = tab === 'records'
      ? window.chessArchive.getRecord(selectedId)
      : window.chessArchive.getGame(selectedId);
    request.then(value => { if (alive) setDetail(value); })
      .catch(e => { if (alive) setDetailError(errorMessage(e)); })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [catalog, tab, selectedId]);

  const currentTab = tabs.find(t => t.key === tab) || tabs[0];
  const chosenBook = catalog?.sources.find(s => s.id === sourceId);
  const hasFilters = Object.entries(filters).some(([k, v]) => v !== defaultFilters[k as keyof Filters]);
  const total = results?.total ?? 0;
  const start = total ? ((results?.page ?? 1) - 1) * (results?.pageSize ?? 40) + 1 : 0;
  const end = Math.min((results?.page ?? 1) * (results?.pageSize ?? 40), total);
  const pageCount = Math.max(1, Math.ceil(total / (results?.pageSize ?? 40)));

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon">♞</div>
        <div><strong>Chess Books</strong><span>EXPLORER</span></div></div>
      <div className="sidebar-scroll">
        <div className="nav-section-title">WORKSPACE</div>
        <nav aria-label="Browse categories">
          {tabs.map(item => {
            const Icon = item.icon;
            return <button key={item.key} onClick={() => chooseTab(item.key)}
              className={'nav-link ' + (tab === item.key ? 'selected' : '')}
              aria-current={tab === item.key ? 'page' : undefined}>
              <Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>
              {tab === item.key && <span className="active-dot" />}
            </button>;
          })}
        </nav>
        <div className="sources-heading"><div className="nav-section-title">YOUR LIBRARY</div>
          {catalog && <span>{catalog.sources.length}</span>}</div>
        <button onClick={() => chooseSource(null)} className={'book-link ' + (sourceId === null ? 'selected' : '')}>
          <Library size={15} /> All books
        </button>
        {catalog?.sources.map(s => <button key={s.id} className={'book-link ' + (s.id === sourceId ? 'selected' : '')}
          title={s.title} onClick={() => chooseSource(s.id)}>
          <BookOpen size={15} /><span>{s.title}</span><span className="book-count">{num(s.game_count)}</span>
        </button>)}
        {!catalog && <div className="library-help">Your books will appear here when you open a database.</div>}
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-db"><Database size={16} />
          <div><strong>{catalog ? 'Local archive' : 'No archive open'}</strong>
            <span title={catalog?.path}>{catalog ? catalog.path.split(/[\\/]/).pop() : 'SQLite database'}</span>
          </div></div>
        <button className="sidebar-open" onClick={openArchive} disabled={opening}>
          <FolderOpen size={16} /> {opening ? 'Opening…' : catalog ? 'Change database' : 'Open database'}
        </button>
      </div>
    </aside>
    <main className="main-area">
      <div className="page-heading">
        <div><div className="overline">THE CHESS LIBRARY <span> / </span> {currentTab.label.toUpperCase()}</div>
          <h1>{chosenBook?.title || currentTab.label}</h1>
          <p>{chosenBook ? (chosenBook.author || 'Book collection') + ' · ' + currentTab.subtitle : currentTab.subtitle}</p>
        </div>
        <button className="secondary-button open-top" onClick={openArchive} disabled={opening}><FolderOpen size={17} /> Open database</button>
      </div>
      {openError && <div className="notice error"><AlertCircle size={17} /> {openError}</div>}
      {!catalog ? <section className="welcome">
        <div className="welcome-symbol">♜</div>
        <div className="eyebrow">YOUR PRIVATE CHESS STUDY</div>
        <h2>Your library begins here.</h2>
        <p>Open a local <strong>schema v3 SQLite</strong> archive to explore annotated games, training positions and book commentary. Your data stays on your computer.</p>
        <button className="primary-button" onClick={openArchive} disabled={opening}><FolderOpen size={17} /> {opening ? 'Opening…' : 'Choose SQLite database'} <ArrowRight size={17} /></button>
        <div className="welcome-foot">Expected file: <code>data/chess-books.sqlite3</code> · Nothing is uploaded or modified.</div>
      </section> : <>
        <div className="stat-strip">
          <div className="stat-item"><div className="stat-icon"><BookMarked size={19} /></div><div><span>BOOKS</span><strong>{num(catalog.totals.books)}</strong></div></div>
          <div className="stat-item"><div className="stat-icon"><Library size={19} /></div><div><span>ALL ENTRIES</span><strong>{num(catalog.totals.entries)}</strong></div></div>
          <div className="stat-item"><div className="stat-icon"><BookOpen size={19} /></div><div><span>GAMES</span><strong>{num(catalog.totals.games)}</strong></div></div>
          <div className="stat-item"><div className="stat-icon"><Target size={19} /></div><div><span>TRAINING</span><strong>{num(catalog.totals.training)}</strong></div></div>
        </div>
        <div className="search-toolbar">
          <label className="search-box"><Search size={19} /><input value={search}
            placeholder={tab === 'records' ? 'Search record keys or extraction metadata…' : 'Search players, books, events, annotations…'}
            onChange={e => { setSearch(e.target.value); setPage(1); }} />
            {search && <button title="Clear search" onClick={() => { setSearch(''); setPage(1); }}><X size={15} /></button>}
          </label>
          <button className={'filter-toggle ' + (filtersOpen || hasFilters ? 'engaged' : '')}
            onClick={() => setFiltersOpen(v => !v)}><SlidersHorizontal size={17} /> Filters
            {hasFilters && <span className="filter-indicator" />}
          </button>
          <button className="icon-button panel-toggle" title={panelOpen ? 'Hide details' : 'Show details'}
            onClick={() => setPanelOpen(v => !v)}>{panelOpen ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}</button>
        </div>
        {filtersOpen && <div className="filters-panel">
          <div className="filters-heading"><div><ListFilter size={17} /> Refine results</div>
            <button className="subtle-button" onClick={() => { setFilters({ ...defaultFilters }); setPage(1); }}><RefreshCw size={14} /> Reset filters</button>
          </div>
          {tab === 'records' ? <div className="filters-grid">
            <SelectInput label="Record type" value={filters.recordType} onChange={v => patchFilter('recordType', v)}
              options={ [['all', 'All records'], ['game', 'Game'], ['text', 'Text']] } />
            <SelectInput label="Extraction status" value={filters.status} onChange={v => patchFilter('status', v)}
              options={ [['all', 'Any status'], ['extracted', 'Extracted'], ['failed', 'Failed']] } />
          </div> : <div className="filters-grid">
            <FilterInput label="White player" value={filters.white} onChange={v => patchFilter('white', v)} />
            <FilterInput label="Black player" value={filters.black} onChange={v => patchFilter('black', v)} />
            <FilterInput label="Event" value={filters.event} onChange={v => patchFilter('event', v)} />
            <FilterInput label="Annotator" value={filters.annotator} onChange={v => patchFilter('annotator', v)} />
            <FilterInput label="ECO prefix" placeholder="e.g. B12" value={filters.eco} onChange={v => patchFilter('eco', v)} />
            <FilterInput label="Year from" placeholder="1900" value={filters.yearFrom} onChange={v => patchFilter('yearFrom', v)} />
            <FilterInput label="Year to" placeholder="2026" value={filters.yearTo} onChange={v => patchFilter('yearTo', v)} />
            <SelectInput label="Result" value={filters.result} onChange={v => patchFilter('result', v)}
              options={ [['all', 'Any result'], ['1-0', '1–0'], ['0-1', '0–1'], ['1/2-1/2', '½–½'], ['*', 'Unfinished']] } />
            <SelectInput label="Training" value={filters.training} onChange={v => patchFilter('training', v)}
              options={ [['all', 'All entries'], ['yes', 'Training only'], ['no', 'Not training']] } />
            <SelectInput label="Deleted in source" value={filters.deleted} onChange={v => patchFilter('deleted', v)}
              options={ [['active', 'Hide deleted'], ['all', 'Include deleted'], ['deleted', 'Only deleted']] } />
          </div>}
        </div>}
        <div className="results-titlebar"><div>
          <h2>{tab === 'records' ? 'Original records' : 'Archive entries'}</h2>
          <span>{fetching ? 'Searching…' : num(total) + ' matching records'}</span>
        </div>
          {tab !== 'records' && <label className="sort-box"><ChevronsUpDown size={15} />
            <select value={filters.sort} onChange={e => patchFilter('sort', e.target.value)}>
              <option value="newest">Newest added</option><option value="oldest">Oldest added</option>
              <option value="year_desc">Year · newest</option><option value="year_asc">Year · oldest</option>
              <option value="white">White player A–Z</option><option value="source">Book title A–Z</option>
            </select></label>}
        </div>
        <div className={'workspace-grid ' + (!panelOpen ? 'no-panel' : '')}>
          <section className="results-panel" aria-label="Archive search results">
            {queryError ? <div className="empty-results"><AlertCircle size={30} /><h3>Unable to search</h3><p>{queryError}</p></div>
              : fetching ? <div className="empty-results"><RefreshCw className="spin" size={28} /><p>Loading your archive…</p></div>
              : !results?.rows.length ? <div className="empty-results"><Search size={30} /><h3>No matches found</h3><p>Try changing the source, search, or active filters.</p>
                <button className="secondary-button" onClick={() => { setSearch(''); setFilters({ ...defaultFilters }); chooseSource(null); }}>Clear search and filters</button></div>
              : <div className="results-list">
                {(results.rows as Array<GameRow | RecordRow>).map(row => {
                  const selected = row.id === selectedId;
                  if (tab === 'records') {
                    const r = row as RecordRow;
                    return <button key={r.id} className={'result-item ' + (selected ? 'selected' : '')}
                      onClick={() => { setSelectedId(r.id); setPanelOpen(true); }}>
                      <span className="item-icon"><Database size={19} /></span>
                      <span className="item-main"><strong>{r.source_record_key}</strong>
                        <small>{r.source_title}</small><span className="item-small">{r.record_type} · {r.raw_moves_size ?? 0} move bytes</span></span>
                      <span className="item-extra"><span className={'tiny-status ' + r.status}>{r.status}</span><ChevronRight size={16} /></span>
                    </button>;
                  }
                  const g = row as GameRow;
                  return <button key={g.id} className={'result-item ' + (selected ? 'selected' : '')}
                    onClick={() => { setSelectedId(g.id); setPanelOpen(true); }}>
                    <span className={'item-icon type-' + g.record_kind}>{g.record_kind === 'position' ? <Target size={20} /> :
                      g.record_kind === 'text' ? <FileText size={20} /> : g.record_kind === 'line' ? <Layers3 size={20} /> : <BookOpen size={20} />}</span>
                    <span className="item-main"><strong>{displayName(g)}</strong>
                      <small>{g.source_title}</small>
                      <span className="item-small">{g.event || kindName(g.record_kind)}{g.year ? ' · ' + g.year : ''}</span></span>
                    <span className="item-extra">
                      {g.eco && <span className="eco-tag">{g.eco}</span>}
                      {g.is_training === 1 && <span title="Training entry" className="training-mark"><Target size={14} /></span>}
                      <span className="result-val">{g.result || '—'}</span>
                      <ChevronRight size={16} /></span>
                  </button>;
                })}
              </div>}
            <div className="pagination"><span>{num(start)}–{num(end)} of {num(total)}</span>
              <div><button className="page-button" aria-label="Previous page" disabled={page <= 1 || fetching}
                onClick={() => setPage(v => Math.max(1, v - 1))}><ChevronLeft size={17} /></button>
                <span>Page {page} of {pageCount}</span>
                <button className="page-button" aria-label="Next page" disabled={page >= pageCount || fetching}
                  onClick={() => setPage(v => Math.min(pageCount, v + 1))}><ChevronRight size={17} /></button></div>
            </div>
          </section>
          {panelOpen && <aside className="details-panel" aria-label="Selected entry details">
            {detailError && <div className="notice error"><AlertCircle size={18} /> {detailError}</div>}
            {detailLoading ? <div className="details-placeholder"><RefreshCw className="spin" size={26} /><span>Opening entry…</span></div>
              : detail && tab === 'records' ? <RecordPanel key={'r' + detail.id} record={detail as RecordDetail} onClose={() => setPanelOpen(false)} />
              : detail ? <GamePanel key={'g' + detail.id} game={detail as GameDetail} onClose={() => setPanelOpen(false)} />
              : !detailError ? <div className="details-placeholder"><div className="placeholder-chess">♙</div><h3>Choose an entry</h3><p>Select a game or position to study it here.</p></div> : null}
          </aside>}
        </div>
        <div className="page-footer"><Hash size={13} /> Read-only local SQLite · Schema v3 <span>·</span> PGNs are verified before display</div>
      </>}
    </main>
  </div>;
}
