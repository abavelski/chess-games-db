import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OpeningPositionBoard } from './OpeningPositionBoard';
import { OpeningArticleCatalog, OpeningArticleReader } from './OpeningArticles';
import { OPENING_START_FEN, appendOpeningMove, openingAnchor, openingBoard } from './opening-session.mjs';
import type { OpeningCatalog, OpeningRoute, OpeningExploration, OpeningGameCard, OpeningArticleCard, OpeningCommentCard, OpeningPage, OpeningExplorerState } from './opening-types';

const tabs = ['articles','games','comments'] as const;
const labels = { articles: 'Articles', games: 'Game records', comments: 'Source comments' };
const languages = [['en','English'],['de','German'],['fr','French'],['es','Spanish'],['it','Italian'],['nl','Dutch'],['pt','Portuguese']] as const;
const num = (n: number) => n.toLocaleString();
type Kind = typeof tabs[number];
type Material = OpeningGameCard | OpeningArticleCard | OpeningCommentCard;
// Controls removed from the workspace must not leave invisible restrictions
// behind when restoring a session from an earlier build.
const visibleRoute = (route: OpeningRoute): OpeningRoute => ({ ...route, filters: route.filters.articleKeys?.length ? { articleKeys: route.filters.articleKeys } : {} });
const visiblePage = (route: OpeningRoute, page: number) => route.filters.roles?.length || route.filters.query || route.filters.annotationLanguages?.length ? 1 : page;
export function OpeningExplorer({ catalog, active, language, onLanguageChange, onOpenArticle, onOpenStudy, initialState, onState }: {
  catalog: OpeningCatalog; active: boolean; language: string; onLanguageChange: (language: string) => void;
  onOpenArticle?: (key: string) => void;
  initialState?: OpeningExplorerState; onState?: (state: OpeningExplorerState) => void;
  onOpenStudy?: (request: { key: string; treeHash?: string; sourcePath?: string; expectedPositionKey?: string; token?: string; notice?: string }) => void;
}) {
  const [route, setRoute] = useState<OpeningRoute>(initialState ? visibleRoute(initialState.route) : { mode: 'prefix', rootFen: OPENING_START_FEN, moves: [], filters: {} });
  const [previous, setPrevious] = useState<{ route: OpeningRoute; page: number; kind: Kind; flipped: boolean } | null>(initialState?.previous ? { ...initialState.previous, route: visibleRoute(initialState.previous.route), page: visiblePage(initialState.previous.route, initialState.previous.page) } : null);
  const [flipped, setFlipped] = useState(initialState?.flipped ?? false);
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ key: string; result: OpeningExploration } | null>(null);
  const [kind, setKind] = useState<Kind>(initialState?.kind ?? 'articles'), [page, setPage] = useState(initialState ? visiblePage(initialState.route, initialState.page) : 1);
  const [material, setMaterial] = useState<{ key: string; value: OpeningPage<Material> } | null>(null);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [articleNames, setArticleNames] = useState<Record<string, string>>(initialState?.articleNames ?? {});
  const [articleView, setArticleView] = useState<'related' | 'catalog' | 'reader'>(initialState?.articleView ?? 'related');
  const [readerKeys, setReaderKeys] = useState<Array<{ key: string; id: number }>>(initialState?.readerKeys ?? []);
  const nextReaderId = useRef(Math.max(0, ...initialState?.readerKeys.map(e => e.id) ?? []));
  const scrolls = useRef<Record<string, number>>(initialState?.scrolls ?? {});
  const state = useMemo(() => ({ route, previous, flipped, kind, page, articleNames, articleView, readerKeys, scrolls: scrolls.current }), [route, previous, flipped, kind, page, articleNames, articleView, readerKeys]);
  useEffect(() => { onState?.(state); }, [state, onState]);
  const sequence = useRef(0), continuationPanel = useRef<HTMLElement>(null);
  const board = useMemo(() => openingBoard(route.rootFen, route.moves), [route.rootFen, route.moves]);
  const routeKey = JSON.stringify(route), result = data?.key === routeKey ? data.result : null;
  useEffect(() => {
    let alive = true;
    const requestId = ++sequence.current;
    setLoading(true); setError(null);
    window.openingStudy.explore({ ...route, revision: catalog.revision, requestId }).then(value => {
      if (alive && requestId === sequence.current) setData({ key: routeKey, result: value });
    }).catch(cause => { if (alive && requestId === sequence.current) setError(String(cause.message)); })
      .finally(() => { if (alive && requestId === sequence.current) setLoading(false); });
    return () => { alive = false; };
  }, [routeKey, catalog.revision]);
  const materialLanguage = kind === 'comments' ? language : '';
  const materialKey = JSON.stringify([result?.token, kind, page, materialLanguage]);
  useEffect(() => {
    if (!result) return;
    let alive = true; setMaterialError(null);
    window.openingStudy.materials<Material>({ revision: catalog.revision, token: result.token, kind, page, language }).then(value => {
      if (alive) setMaterial({ key: materialKey, value });
    }).catch(cause => { if (alive) setMaterialError(String(cause.message)); });
    return () => { alive = false; };
  }, [result?.token, kind, page, materialLanguage, catalog.revision]);
  const visibleMaterial = material?.key === materialKey ? material.value : null;
  const play = useCallback((uci: string) => {
    const next = appendOpeningMove(route, uci);
    setRoute(next); setPage(1); setError(null);
  }, [route]);
  const jump = (length: number) => { setRoute(current => ({ ...current, moves: current.moves.slice(0, length) })); setPage(1); };
  const anchor = (fen: string) => {
    try {
      const next = openingAnchor(route, fen);
      if (route.mode === 'prefix') setPrevious({ route, kind, page, flipped });
      setRoute(next); setPage(1); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const setFilter = (patch: Partial<OpeningRoute['filters']>) => { setRoute(current => ({ ...current, filters: { ...current.filters, ...patch } })); setPage(1); };
  const studyArticle = (article: OpeningArticleCard) => {
    setArticleNames(current => ({ ...current, [article.key]: article.title })); setFilter({ articleKeys: [article.key] });
  };
  const readArticle = (key: string) => {
    const id = ++nextReaderId.current;
    setReaderKeys(current => current.at(-1)?.key === key ? current : [...current, { key, id }].slice(-8));
    setArticleView('reader'); onOpenArticle?.(key);
  };
  const openGame = (game: OpeningGameCard, sourcePath = game.match.sourcePath) => onOpenStudy?.({ key: game.key, treeHash: game.treeHash,
    sourcePath, expectedPositionKey: board.exactKey, token: result?.token });
  const pageCount = Math.max(1, Math.ceil((visibleMaterial?.total ?? 0) / (visibleMaterial?.pageSize ?? 20)));
  return <div className="opening-explorer" aria-label="Opening explorer" onScrollCapture={event => {
    const target = event.target as HTMLElement;
    const key = target.dataset.openingScrollKey;
    if (key) { scrolls.current[key] = target.scrollTop; onState?.({ ...state, scrolls: { ...scrolls.current } }); }
  }} onKeyDown={event => {
    const target = event.target;
    if (!active || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey ||
      (target instanceof HTMLElement && target.closest('input,textarea,select,button,a,[contenteditable], [data-reading]'))) return;
    if (event.key === 'ArrowLeft') { jump(Math.max(0, route.moves.length - 1)); event.preventDefault(); }
    if (event.key === 'Home') { jump(0); event.preventDefault(); }
    if (event.key === 'ArrowRight' && result?.continuations[0]) { play(result.continuations[0].uci); event.preventDefault(); }
  }}>
    <div className="opening-session-label"><strong>{route.mode === 'prefix' ? 'Following move order' : 'Position anchor'}</strong>
      {route.mode === 'position' && previous && <button type="button" onClick={() => {
        setRoute(previous.route); setKind(previous.kind); setPage(previous.page); setFlipped(previous.flipped); setPrevious(null);
      }}>Return to previous move order</button>}</div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="opening-layout">
      <section className="opening-board-panel" aria-label="Opening board and path">
        <OpeningPositionBoard initialFen={route.rootFen} moves={route.moves} flipped={flipped} onPlay={play} active={active} />
        <div className="opening-board-controls"><button type="button" onClick={() => setFlipped(value => !value)}>Flip</button>
          <button type="button" disabled={!route.moves.length} onClick={() => jump(route.moves.length - 1)}>Undo</button>
          <button type="button" disabled={!route.moves.length} onClick={() => jump(0)}>Reset path</button></div>
        <p role="status">{board.turn === 'white' ? 'White' : 'Black'} to move{!board.position.hasDests() ? ' · Terminal position' : board.position.isCheck() ? ' · Check' : ''}</p>
        <nav className="opening-breadcrumb" aria-label="Chosen move order"><button type="button" onClick={() => jump(0)}>Start</button>
          {board.sans.map((san, i) => <button key={i} type="button" aria-current={i === board.sans.length - 1 ? 'step' : undefined} onClick={() => jump(i + 1)}>{san}</button>)}</nav>
        <button type="button" className="secondary-button" onClick={() => anchor(board.fen)}>Find other move orders</button>
      </section>
      <section className="opening-continuations" ref={continuationPanel} tabIndex={-1} aria-label="Opening continuations" aria-busy={loading}>
        <h2>Continuations</h2>
        <div className="opening-counters" aria-label="Opening counters" role="status">
          <span><strong>{result ? num(result.gameRecordCount) : '…'}</strong> Game records</span>
          <span><strong>{result ? num(result.sourceLineCount) : '…'}</strong> Source lines</span>
          <span><strong>{result ? num(result.relatedArticleCount) : '…'}</strong> Related articles</span>
        </div>
        {!result && !error && <p role="status">Updating continuations…</p>}
        {result && <>
          {!!result.endingLineCount && <p>{num(result.endingLineCount)} source {result.endingLineCount === 1 ? 'line ends' : 'lines end'} here.</p>}
          {result.emptyLibrary ? <p>This library has no playable source trees. Articles remain available.</p>
            : !result.gameRecordCount ? <p>No indexed continuation in this library subset. Undo a move or change the filters.</p>
            : result.exhausted ? <p>The matching source lines end here. You can undo or continue legally beyond the indexed material.</p> : null}
          <div className="opening-replies">{result.continuations.map(move => <button key={move.uci} data-opening-reply={move.uci} type="button" onKeyDown={event => {
            if (!['ArrowUp','ArrowDown'].includes(event.key)) return;
            const buttons = [...(continuationPanel.current?.querySelectorAll<HTMLButtonElement>('[data-opening-reply]') ?? [])];
            const index = buttons.indexOf(event.currentTarget); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); event.preventDefault();
          }} onClick={() => { continuationPanel.current?.focus({ preventScroll: true }); play(move.uci); }}>
            <strong>{move.san}</strong><span>{num(move.gameRecordCount)} records · {num(move.sourceLineCount)} lines · {num(move.relatedArticleCount)} articles</span>
          </button>)}</div>
        </>}
      </section>
      <section className="opening-material" aria-label="Opening study material">
        {!!route.filters.articleKeys?.length && <div className="opening-filter-chip">Article: {articleNames[route.filters.articleKeys[0]] ?? route.filters.articleKeys[0]}
          <button type="button" aria-label="Clear article filter" onClick={() => setFilter({ articleKeys: [] })}>×</button></div>}
        <div className="opening-reading-navigation"><button type="button" onClick={() => setArticleView('catalog')}>Browse all article titles</button>
          {articleView !== 'related' && <button type="button" onClick={() => setArticleView('related')}>Back to matching material</button>}
          {articleView === 'reader' && readerKeys.length > 1 && <button type="button" onClick={() => setReaderKeys(current => current.slice(0, -1))}>Previous article</button>}</div>
        <div hidden={articleView !== 'related'}>
        <div className="opening-material-tabs" role="tablist" aria-label="Study material">{tabs.map((tab, index) => <button key={tab} type="button" role="tab"
          id={`opening-${tab}-tab`} aria-controls="opening-material-panel" aria-selected={kind === tab} tabIndex={kind === tab ? 0 : -1}
          onClick={() => { setKind(tab); setPage(1); }} onKeyDown={event => {
            if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
            const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
            setKind(next); setPage(1); document.getElementById(`opening-${next}-tab`)?.focus(); event.preventDefault();
          }}>{labels[tab]}</button>)}</div>
        <label className="opening-reading-language">Reading language<select aria-label="Opening reading language" value={language} onChange={event => onLanguageChange(event.target.value)}>{languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div id="opening-material-panel" role="tabpanel" aria-labelledby={`opening-${kind}-tab`} aria-busy={!visibleMaterial && !materialError}>
          {materialError && <p role="alert">{materialError}</p>}
          {!visibleMaterial && !materialError && <p role="status">Loading study material…</p>}
          {visibleMaterial?.items.map(item => kind === 'articles' ? (() => {
            const article = item as OpeningArticleCard;
            return <article key={article.key} className="opening-material-card"><h3><button type="button" onClick={() => readArticle(article.key)}>{article.title}</button></h3>
              <p>{article.evidence?.includes('explicit_link') ? 'Linked example' : 'Same chapter'}</p><small>{article.source}</small>
              <button type="button" onClick={() => { studyArticle(article); readArticle(article.key); }}>Study this article</button>
              <small>Read the explanation and limit continuations to this article.</small></article>;
          })() : kind === 'games' ? (() => {
            const game = item as OpeningGameCard;
            return <article key={game.key} className="opening-material-card"><h3>{game.white || 'Unknown'} — {game.black || 'Unknown'}</h3><p>{[game.event, game.date, game.eco].filter(Boolean).join(' · ')}</p>
              <small>{game.source}{game.annotator ? ` · ${game.annotator}` : ''}</small>{game.annotationCoverage === 'partial' && <p>Partial annotation support</p>}
              {onOpenStudy && <button type="button" onClick={() => openGame(game)}>Open annotated example</button>}
              {game.matchCount > 1 && <details><summary>{game.matchCount} matching source branches</summary>{game.matches.map(match => <button type="button" key={match.sourcePath} disabled={!onOpenStudy} onClick={() => openGame(game, match.sourcePath)}>Branch {match.sourcePath || 'root'} · ply {match.ply}</button>)}</details>}
            </article>;
          })() : (() => {
            const comment = item as OpeningCommentCard;
            return <article key={`${comment.key}:${comment.sequence}`} className="opening-material-card"><h3>{comment.white || 'Unknown'} — {comment.black || 'Unknown'}</h3>
              <p>{comment.text}{comment.previewTruncated ? '…' : ''}</p><small>{comment.annotator || 'Source author'} · {comment.sourceLanguage || 'untagged'} · {comment.placement} · branch {comment.sourcePath || 'root'}{comment.fallback ? ' · language fallback' : ''}</small>
              {onOpenStudy && <button type="button" onClick={() => onOpenStudy({ key: comment.key, treeHash: comment.treeHash, sourcePath: comment.sourcePath, expectedPositionKey: board.exactKey, token: result?.token })}>Inspect source comment</button>}
            </article>;
          })())}
          {visibleMaterial?.total === 0 && <p>No {labels[kind].toLowerCase()} match the selected route and filters.</p>}
        </div>
        <div className="opening-pagination"><button type="button" disabled={page <= 1 || !visibleMaterial} onClick={() => setPage(value => value - 1)}>Previous</button>
          <span>Page {page} of {pageCount}</span><button type="button" disabled={page >= pageCount || !visibleMaterial} onClick={() => setPage(value => value + 1)}>Next</button></div>
        </div>
        <div hidden={articleView !== 'catalog'}><OpeningArticleCatalog catalog={catalog} active={active && articleView === 'catalog'} onOpen={readArticle} /></div>
        {readerKeys.map((entry, i) => <div key={entry.id} hidden={articleView !== 'reader' || i !== readerKeys.length - 1}>
          {onOpenStudy && <OpeningArticleReader catalog={catalog} articleKey={entry.key} language={language}
            selectedForStudy={route.filters.articleKeys?.length === 1 && route.filters.articleKeys[0] === entry.key}
            initialScroll={scrolls.current[entry.key] ?? 0}
            active={active && articleView === 'reader' && i === readerKeys.length - 1} onArticle={readArticle} onStudy={onOpenStudy} onFilter={studyArticle} onLanguageChange={onLanguageChange} />}
        </div>)}
      </section>
    </div>
    <p className="opening-coverage">Indexed subset: {catalog.coverage.quarantinedDocuments} quarantined records; {catalog.coverage.deletedRecords} source-deleted records excluded; {num(catalog.coverage.unsupportedAnnotations)} unsupported annotations. Source theory is not claimed complete or current.</p>
  </div>;
}
