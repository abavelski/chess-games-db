import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MessageSquarePlus, Save, Trash2, Scissors } from 'lucide-react';
import type { Key } from '@lichess-org/chessground/types';
import { chessgroundDests } from 'chessops/compat';
import { makeSquare, parseSquare } from 'chessops/util';
import { isMoveData } from '@lichess-org/pgn-viewer/game';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { FavouriteButton } from './FavouriteButton';
import { PieceMode } from './PieceMode';
import { EnginePanel, EvaluationBar, readReviewPreferences, type ReviewDisplay } from './EnginePanel';
import { appendMove, replayPosition, sourcePosition, type AnalysisPosition } from './analysis.mjs';
import { useEngineAnalysis } from './useEngineAnalysis';
import type { AnalysisOptions } from './engine-types';
import { Path } from '@lichess-org/pgn-viewer/path';
import { annotationShapes } from '@lichess-org/pgn-viewer/view/glyph';
import { PgnBoard, type Viewer } from './PgnBoard';
import { ReviewMoves } from './ReviewMoves';
import { useBoardResize } from './useBoardResize';
import { criticalNavigation, criticalReveal, criticalRevealStage } from './critical-positions.mjs';
import { emptyPersonal, mergePersonal, personalPath, personalReviewTokens, updatePersonalComment, removePersonalMove } from './personal.mjs';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { reviewPgn } from './pgn.mjs';
import type { GameDetail } from './types';

export function GameReview({ game, initialPath, onClose, onToggleFavourite, savingFavourite, favouriteError, onPersonalSaved }: { onPersonalSaved: () => void; game: GameDetail; initialPath: string; onClose: () => void; onToggleFavourite: () => void; savingFavourite: boolean; favouriteError: string | null }) {
  const viewer = useRef<Viewer | null>(null);
  const commentEditor = useRef<HTMLTextAreaElement>(null);
  const [showCommentEditor, setShowCommentEditor] = useState(false);
  useEffect(() => { if (showCommentEditor) commentEditor.current?.focus(); }, [showCommentEditor]);
  const transcript = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState(initialPath);
  const [personal, setPersonal] = useState(() => game.personal || emptyPersonal());
  const [saved, setSaved] = useState(() => JSON.stringify(game.personal || emptyPersonal()));
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [personalError, setPersonalError] = useState<string | null>(null);
  const selectedPath = useRef(initialPath);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const dirty = JSON.stringify(personal) !== saved;
  const savePersonal = async (snapshot = personal) => {
    setSavingPersonal(true); setPersonalError(null);
    const request = saveQueue.current.catch(() => {}).then(() => window.chessArchive.savePersonal(game.id, snapshot));
    saveQueue.current = request;
    try { await request; setSaved(JSON.stringify(snapshot)); onPersonalSaved(); return true; }
    catch (error) { setPersonalError('Could not save your analysis: ' + (error instanceof Error ? error.message : String(error))); return false; }
    finally { if (saveQueue.current === request) setSavingPersonal(false); }
  };
  const savedPersonal = JSON.parse(saved);
  const hasPersonalAnalysis = personal.comments.length > 0 || personal.lines.length > 0 || savedPersonal.comments.length > 0 || savedPersonal.lines.length > 0;
  const deletePersonalAnalysis = async () => {
    const cleared = emptyPersonal();
    if (await savePersonal(cleared)) setPersonal(cleared);
  };
  const closeReview = () => {
    if (savingPersonal) return;
    if (dirty) setConfirmExit(true);
    else onClose();
  };
  const closeRef = useRef(closeReview);
  closeRef.current = closeReview;
  const merged = useMemo(() => {
    try { return { ...mergePersonal(game.pgn, personal), error: null }; }
    catch (error) { return { pgn: game.pgn, ownPaths: new Set<string>(), comments: new Map<string, string>(), error: String(error) }; }
  }, [game.pgn, personal]);
  const [preferences] = useState(readReviewPreferences);
  const [display, setDisplay] = useState(preferences.display);
  const [analysisOptions, setAnalysisOptions] = useState<AnalysisOptions>({ stockfish: false, maia: false, lines: preferences.lines, maiaLines: preferences.maiaLines, rating: preferences.rating, revision: 0 });
  const [flipped, setFlipped] = useState(false);
  const [pieceMode, setPieceMode] = useState<{ fen: string; orientation: 'white' | 'black'; scroll: number; focus: HTMLElement | null } | null>(null);
  const returnFromPieceMode = useCallback(() => {
    const saved = pieceMode;
    setPieceMode(null);
    requestAnimationFrame(() => {
      if (saved?.focus?.isConnected) saved.focus.focus({ preventScroll: true });
      if (transcript.current && saved) transcript.current.scrollTop = saved.scroll;
    });
  }, [pieceMode]);
  const [promotion, setPromotion] = useState<{ from: string; to: string; position: AnalysisPosition } | null>(null);
  const [ready, setReady] = useState(false);
  const model = useMemo(() => {
    try { return { data: reviewPgn(merged.pgn), error: null }; }
    catch (error) { return { data: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [merged.pgn]);
  const [revealStage, setRevealStage] = useState(() => criticalRevealStage(model.data?.tokens || [], initialPath));
  const updateDisplay = useCallback((action: React.SetStateAction<ReviewDisplay>) => {
    const next = typeof action === 'function' ? action(display) : action;
    if (next.criticalStudy && !display.criticalStudy) {
      setRevealStage(criticalRevealStage(model.data?.tokens || [], path));
    }
    setDisplay(next);
  }, [display, model.data, path]);
  const revealed = useMemo(() => criticalReveal(model.data?.tokens || [], revealStage, display.criticalStudy), [model.data, revealStage, display.criticalStudy]);
  const reviewTokens = useMemo(() => personalReviewTokens(model.data?.tokens || [], merged.ownPaths, revealed), [model.data, merged.ownPaths, revealed]);
  const allowedPaths = useMemo(() => new Set(['', ...reviewTokens.flatMap(token => token.type === 'move' && token.path ? [token.path] : [])]), [reviewTokens]);
  const revealRef = useRef({ ...revealed, allowedPaths });
  revealRef.current = { ...revealed, allowedPaths };
  const canSelectPath = useCallback((value: string) => !revealRef.current.paused || revealRef.current.allowedPaths.has(value), []);
  const nextReveal = useMemo(() => revealed.paused ? criticalReveal(model.data?.tokens || [], revealStage + 1) : null, [model.data, revealStage, revealed.paused]);
  const critical = useMemo(() => criticalNavigation(revealed.tokens, path), [revealed.tokens, path]);
  const resize = useBoardResize();
  const selectReviewPath = useCallback((value: string) => viewer.current?.toPath(new Path(value), false), []);
  const editComment = useCallback((value: string) => {
    viewer.current?.toPath(new Path(value), false);
    setShowCommentEditor(true);
    requestAnimationFrame(() => commentEditor.current?.focus());
  }, []);
  const onReady = useCallback((value: Viewer | null) => {
    viewer.current = value; setReady(!!value);
    if (value) {
      const target = selectedPath.current;
      if (value.game.nodeAt(new Path(target))) value.toPath(new Path(target), false);
      setPath(value.path.path);
    }
  }, []);
  const onPathChange = useCallback((value: string) => { selectedPath.current = value; setPromotion(null); setPath(value); }, []);
  const source = useMemo(() => {
    if (!ready || !viewer.current) return null;
    try { return sourcePosition(viewer.current); } catch { return null; }
  }, [ready, path, merged.pgn]);
  const position = source;
  const explore = useCallback((next: AnalysisPosition) => {
    const initial = Chess.fromSetup(parseFen(next.initialFen).unwrap()).unwrap();
    const target = personalPath(initial, next.moves);
    if (viewer.current?.game.nodeAt(new Path(target))) {
      viewer.current.toPath(new Path(target), false);
      return;
    }
    selectedPath.current = target;
    setPromotion(null);
    setPersonal(previous => ({ ...previous, lines: [...previous.lines.filter(line => !(line.length < next.moves.length && line.every((move, index) => move === next.moves[index]))), next.moves] }));
  }, []);
  const deleteSelectedMove = () => {
    if (!position || savingPersonal || !merged.ownPaths.has(path)) return;
    try {
      setPersonal(previous => removePersonalMove(game.pgn, previous, position.moves));
      setPersonalError(null);
    } catch (error) { setPersonalError(error instanceof Error ? error.message : String(error)); }
  };
  const engines = useEngineAnalysis(position, analysisOptions, !!pieceMode);
  const configureBoard = useCallback((board: Viewer) => {
    const current = (() => { try { return sourcePosition(board); } catch { return null; } })();
    if (!current || !board.ground) return;
    setFlipped(board.orientation() === 'black');
    const data = board.curData();
    const shapes: DrawShape[] = display.book ? data.shapes.map(shape => ({ orig: makeSquare(shape.from), dest: makeSquare(shape.to), brush: shape.color })) : [];
    const auto: DrawShape[] = display.book && isMoveData(data) ? annotationShapes(data, board.opts.maxGlyphs, board.opts.showRepetitions) : [];
    const arrows = (moves: string[], brush: string, width: number) => moves.forEach((move, index) => {
      if (move && move.length >= 4) auto.push({ orig: move.slice(0, 2) as Key, dest: move.slice(2, 4) as Key, brush, modifiers: { lineWidth: Math.max(2, width - index) } });
    });
    if (analysisOptions.stockfish && display.arrows) arrows(engines.stockfish.lines.map(line => line.moves[0]), 'engine', 9);
    if (analysisOptions.maia && display.maiaArrows) arrows(engines.maia.candidates.map(candidate => candidate.move), 'human', 5);
    board.ground.set({ ...(board.ground.getFen() !== current.fen.split(' ')[0] ? { fen: current.fen } : {}), check: current.position.isCheck(), lastMove: board.cgState().lastMove,
      drawable: { shapes, autoShapes: auto, brushes: { ...board.ground.state.drawable.brushes, engine: { key: 'engine', color: '#27854c', opacity: 0.75, lineWidth: 9 }, human: { key: 'human', color: '#9155c2', opacity: 0.9, lineWidth: 5 } } },
      turnColor: current.turn, movable: { free: false, color: current.turn, dests: chessgroundDests(current.position), events: { after: (from, to) => {
        const piece = current.position.board.get(parseSquare(from)!);
        if (piece?.role === 'pawn' && (to[1] === '1' || to[1] === '8')) { setPromotion({ from, to, position: current }); return; }
        try { explore(appendMove(current, from, to)); } catch { board.toPath(board.path, false); }
      } } }, draggable: { enabled: true }, selectable: { enabled: true }, premovable: { enabled: false } });
  }, [explore, display, analysisOptions.stockfish, analysisOptions.maia, engines]);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `Game review · ${game.white || game.event || game.source_title}`;
    const keydown = (event: KeyboardEvent) => {
      if (pieceMode || confirmExit) return; // Native dialogs own Escape and focus.
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('[data-board-resize]') &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
        (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, dialog, [role="textbox"]')))) return;
      const board = viewer.current;
      switch (event.key) {
        case 'ArrowLeft': board?.goTo(event.shiftKey ? 'first' : 'prev', false); break;
        case 'ArrowRight': board?.goTo(event.shiftKey ? 'last' : 'next', false); break;
        case 'Home': case 'ArrowUp': board?.goTo('first', false); break;
        case 'End': case 'ArrowDown': board?.goTo('last', false); break;
        case 'f': case 'F': board?.flip(); break;
        case 'Escape': void closeRef.current(); break;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', keydown, true);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      document.title = previousTitle;
    };
  }, [game.white, game.event, game.source_title, onClose, pieceMode, confirmExit]);
  useEffect(() => {
    const current = transcript.current?.querySelector('[aria-current="step"]');
    current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [path]);
  const move = model.data?.tokens.find(token => token.type === 'move' && token.path === path);
  const title = game.white || game.black ? `${game.white || 'Unknown'} vs ${game.black || 'Unknown'}` : game.event || 'Study position';
  const go = (direction: 'first' | 'prev' | 'next' | 'last') => viewer.current?.goTo(direction, false);
  const currentNode = viewer.current?.game.nodeAt(new Path(path));
  return <main className={"review-shell" + (game.opening?.name ? " has-opening" : "")}>
    <header className="review-header">
      <div>
        <div className="eyebrow">GAME REVIEW · {game.source_title}</div>
        <div className="review-title"><h1>{title}</h1><FavouriteButton favourite={!!game.favourite} disabled={savingFavourite} onClick={onToggleFavourite} label={title} /></div>
        {game.opening?.name && <p className="review-opening-name" title={game.opening.name}>{game.opening.name} · {game.opening.eco}{game.eco && game.eco !== game.opening.eco ? ` · Source ECO ${game.eco}` : ''}</p>}
        <p>{[game.event, game.site, game.date, game.opening?.name ? null : game.eco, revealed.paused ? null : game.result].filter(value => value && value !== '?').join(' · ')}</p>
      </div>
      <button className="secondary-button" disabled={savingPersonal} onClick={() => void closeReview()} autoFocus><ArrowLeft size={16} /> Back to games</button>
    </header>
    {favouriteError && <div role="alert" className="notice error">{favouriteError}</div>}
    <div className={"review-workspace" + (resize.resizing ? " resizing-board" : "")} ref={resize.workspace}>
      <section ref={resize.board} className="review-board" aria-label="Game review board">
        <div className={"analysis-board-frame" + (display.bar && analysisOptions.stockfish ? " with-bar" : "")}><div className="review-board-surface"><PgnBoard pgn={merged.pgn} reviewPath={selectedPath.current} review initialPath={initialPath} canSelectPath={canSelectPath} onReady={onReady} onPathChange={onPathChange} configureBoard={configureBoard} /><button {...resize.handle} data-board-resize className="board-resize-handle" title="Drag to resize board. Double-click to reset." /></div>{display.bar && analysisOptions.stockfish && <EvaluationBar state={engines.stockfish} enabled={analysisOptions.stockfish} flipped={flipped} />}</div>

        <div className="review-board-footer" ref={resize.footer}><div className="review-controls" role="group" aria-label="Move navigation">
          <button title="First position" aria-label="First position" disabled={!ready || !path} onClick={() => go('first')}><ChevronsLeft size={21} /></button>
          <button title="Previous move" aria-label="Previous move" disabled={!ready || !path} onClick={() => go('prev')}><ChevronLeft size={24} /></button>
          <span aria-live="polite">{move ? `${Math.ceil((move.ply || 1) / 2)}${(move.ply || 1) % 2 ? '.' : '…'} ${move.san}` : 'Starting position'}</span>
          <button title="Next move" aria-label="Next move" disabled={!ready || !currentNode?.children.some(node => canSelectPath(node.data.path.path))} onClick={() => go('next')}><ChevronRight size={24} /></button>
          <button title="Last mainline position" aria-label="Last mainline position" disabled={!ready || revealed.paused || !viewer.current?.game.mainline.length} onClick={() => go('last')}><ChevronsRight size={21} /></button>
        </div>
        <p className="review-help">Select any move or variation to explore it. ← / → moves · Home / End first / last · F flips · Esc returns to games.</p>
        {game.start_fen && <details className="review-position"><summary>Starting position</summary><code>{game.start_fen}</code></details>}
        </div>
      </section>
      <section className="review-score" aria-label="Game score and annotations">
        <div className="piece-entry"><button disabled={!position || !!promotion} onClick={() => {
          if (position && viewer.current) setPieceMode({ fen: position.fen, orientation: viewer.current.orientation(), scroll: transcript.current?.scrollTop || 0, focus: document.activeElement instanceof HTMLElement ? document.activeElement : null });
        }}>Piece mode</button>
          {critical.total > 0 && <div className="review-critical-navigation" role="group" aria-label="Study stops">
            <button aria-label="Previous study stop" title="Previous study stop (critical positions and medals, including variations)"
              disabled={!ready || !!promotion || !critical.previous} onClick={() => selectReviewPath(critical.previous!)}><ChevronLeft size={16} /></button>
            <span aria-live="polite">{critical.current ? `${critical.current} / ${critical.total}` : `${critical.total} stops`}</span>
            <button aria-label="Next study stop" title="Next study stop (critical positions and medals, including variations)"
              disabled={!ready || !!promotion || !critical.next} onClick={() => selectReviewPath(critical.next!)}><ChevronRight size={16} /></button>
          </div>}
        </div>
        <EnginePanel toolbarActions={<>
          <button type="button" className="review-comment-button" aria-label="Add comment" title={showCommentEditor ? 'Hide comment editor' : merged.comments.has(path) ? 'Edit comment' : 'Add comment'}
            aria-expanded={showCommentEditor} aria-controls="personal-comment-editor" disabled={!position}
            onClick={() => setShowCommentEditor(value => !value)}><MessageSquarePlus size={17} aria-hidden="true" /></button>
          <button type="button" className="review-comment-button" aria-label="Save my comments" title="Save my comments and lines"
            disabled={!dirty || savingPersonal || !!merged.error} aria-busy={savingPersonal} onClick={() => void savePersonal()}><Save size={17} aria-hidden="true" /></button>
          <button type="button" className="review-comment-button" aria-label="Delete my lines and comments" title="Delete all my lines and comments in this game"
            disabled={!hasPersonalAnalysis || savingPersonal} onClick={() => void deletePersonalAnalysis()}><Trash2 size={17} aria-hidden="true" /></button>
          {merged.ownPaths.has(path) && <button type="button" className="review-comment-button" aria-label="Delete selected personal move"
            title="Delete this move and its continuation from my line" disabled={savingPersonal || !!promotion} onClick={deleteSelectedMove}><Scissors size={17} aria-hidden="true" /></button>}
        </>} onFlip={() => viewer.current?.flip()} canFlip={ready} options={analysisOptions} setOptions={setAnalysisOptions} display={display} setDisplay={updateDisplay} states={engines} position={position} onPreview={moves => { if (position) explore(replayPosition(position.initialFen, moves)); }} />
        {(personalError || merged.error) && <p className="notice error" role="alert">{personalError || merged.error}</p>}
        {showCommentEditor && <div className="personal-comment-editor" id="personal-comment-editor">
          <textarea ref={commentEditor} aria-label="My comment on this position" disabled={!position || savingPersonal} maxLength={20000} value={merged.comments.get(path) || ''} placeholder="Write your own comment..."
            onChange={event => {
              if (!position) return;
              const text = event.target.value, moves = [...position.moves];
              setPersonal(previous => updatePersonalComment(previous, moves, text));
            }} />
          <button type="button" className="delete-position-comment" aria-label="Delete comment at this position" title="Delete only the comment at this position"
            disabled={!position || !merged.comments.has(path) || savingPersonal}
            onClick={() => { if (position) setPersonal(previous => updatePersonalComment(previous, position.moves, '')); }}><Trash2 size={16} aria-hidden="true" /></button>
        </div>}
        {promotion && <div className="promotion-choice" role="group" aria-label="Choose promotion">Promote to {(['queen', 'rook', 'bishop', 'knight'] as const).map(role => <button key={role} onClick={() => { explore(appendMove(promotion.position, promotion.from, promotion.to, role)); setPromotion(null); }}>{role}</button>)}</div>}
        <div className="review-transcript" ref={transcript}>
          {model.error && <div className="notice error">{model.error}</div>}
          {model.data?.positionError && <div className="notice error">{model.data.positionError}</div>}
          {model.data && <ReviewMoves showGlyphDescriptions={display.glyphDescriptions} tokens={reviewTokens} ownPaths={merged.ownPaths} personalComments={merged.comments} onEditComment={editComment} path={path} ready={ready} onSelect={selectReviewPath}
            revealPath={revealed.paused ? revealed.path : undefined} revealToEnd={!nextReveal?.paused}
            onReveal={() => setRevealStage(stage => stage + 1)} />}
          {!revealed.paused && game.result && game.result !== '*' && <p className="review-result">{game.result}</p>}
          {!revealed.paused && <><details className="review-headers"><summary>Game information · all PGN headers</summary><dl>
            {model.data?.headers.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || '—'}</dd></div>)}
          </dl></details>
          <details className="review-original"><summary>Original PGN</summary><pre>{game.pgn}</pre></details></>}
        </div>
      </section>
    </div>
    {confirmExit && <UnsavedChangesDialog saving={savingPersonal} error={personalError}
      onSave={async () => { if (await savePersonal()) onClose(); }}
      onDiscard={onClose} onCancel={() => setConfirmExit(false)} />}
    {pieceMode && <PieceMode fen={pieceMode.fen} orientation={pieceMode.orientation} onReturn={returnFromPieceMode} />}
  </main>;
}

function UnsavedChangesDialog({ saving, error, onSave, onDiscard, onCancel }: {
  saving: boolean; error: string | null; onSave: () => Promise<void>; onDiscard: () => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="unsaved-changes-dialog" aria-labelledby="unsaved-changes-title"
    onCancel={event => { event.preventDefault(); if (!saving) onCancel(); }}>
    <h2 id="unsaved-changes-title">You have unsaved changes</h2>
    <p>Save your lines and comments or discard these changes before returning to the games list.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="unsaved-changes-actions">
      <button disabled={saving} onClick={() => void onSave()}>{saving ? 'Saving...' : 'Save'}</button>
      <button disabled={saving} onClick={onDiscard}>Discard</button>
      <button autoFocus disabled={saving} onClick={onCancel}>Cancel</button>
    </div>
  </dialog>;
}
