import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Compass } from 'lucide-react';
import type { Key } from '@lichess-org/chessground/types';
import { chessgroundDests } from 'chessops/compat';
import { makeSquare, parseSquare } from 'chessops/util';
import { isMoveData } from '@lichess-org/pgn-viewer/game';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { PieceMode } from './PieceMode';
import { EnginePanel, EvaluationBar, readReviewPreferences } from './EnginePanel';
import { appendMove, replayPosition, sourcePosition, type AnalysisPosition } from './analysis.mjs';
import { useEngineAnalysis } from './useEngineAnalysis';
import type { AnalysisOptions } from './engine-types';
import { Path } from '@lichess-org/pgn-viewer/path';
import { annotationShapes, glyphs } from '@lichess-org/pgn-viewer/view/glyph';
import { PgnBoard, type Viewer } from './PgnBoard';
import { reviewPgn, type ReviewToken } from './pgn.mjs';
import type { GameDetail } from './types';

const annotationGlyphs: Record<number, { symbol: string; name: string }> = {
  ...glyphs,
  11: { symbol: '=', name: 'Equal chances, quiet position' },
  12: { symbol: '=', name: 'Equal chances, active position' },
};

export function GameReview({ game, initialPath, onClose, embedded = false }: { game: GameDetail; initialPath: string; onClose: () => void; embedded?: boolean }) {
  const viewer = useRef<Viewer | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState(initialPath);
  const [temporary, setTemporary] = useState<AnalysisPosition | null>(null);
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
    try { return { data: reviewPgn(game.pgn), error: null }; }
    catch (error) { return { data: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [game.pgn]);
  const score = useMemo(() => {
    const tokens = model.data?.tokens || [];
    const groups: Array<{ tokens: ReviewToken[]; index: number }> = [];
    for (let index = 0; index < tokens.length; index++) {
      const white = tokens[index];
      const black = tokens[index + 1];
      const paired = white.type === 'move' && (white.ply || 0) % 2 === 1 &&
        black?.type === 'move' && black.ply === white.ply! + 1 && black.depth === white.depth &&
        (white.path === null || black.path?.slice(0, -2) === white.path);
      groups.push({ tokens: paired ? [white, black] : [white], index });
      if (paired) index++;
    }
    return groups;
  }, [model]);
  const onReady = useCallback((value: Viewer | null) => {
    viewer.current = value; setReady(!!value);
    if (value) setPath(value.path.path);
  }, []);
  const onPathChange = useCallback((value: string) => { setTemporary(null); setPromotion(null); setPath(value); }, []);
  const source = useMemo(() => {
    if (!ready || !viewer.current) return null;
    try { return sourcePosition(viewer.current); } catch { return null; }
  }, [ready, path]);
  const position = temporary || source;
  const engines = useEngineAnalysis(position, analysisOptions, !!pieceMode);
  const configureBoard = useCallback((board: Viewer) => {
    const current = temporary || (() => { try { return sourcePosition(board); } catch { return null; } })();
    if (!current || !board.ground) return;
    setFlipped(board.orientation() === 'black');
    const data = board.curData();
    const shapes: DrawShape[] = !temporary && display.book ? data.shapes.map(shape => ({ orig: makeSquare(shape.from), dest: makeSquare(shape.to), brush: shape.color })) : [];
    const auto: DrawShape[] = !temporary && display.book && isMoveData(data) ? annotationShapes(data, board.opts.maxGlyphs, board.opts.showRepetitions) : [];
    const arrows = (moves: string[], brush: string, width: number) => moves.forEach((move, index) => {
      if (move && move.length >= 4) auto.push({ orig: move.slice(0, 2) as Key, dest: move.slice(2, 4) as Key, brush, modifiers: { lineWidth: Math.max(2, width - index) } });
    });
    if (analysisOptions.stockfish && display.arrows) arrows(engines.stockfish.lines.map(line => line.moves[0]), 'engine', 9);
    if (analysisOptions.maia && display.maiaArrows) arrows(engines.maia.candidates.map(candidate => candidate.move), 'human', 5);
    board.ground.set({ ...(board.ground.getFen() !== current.fen.split(' ')[0] ? { fen: current.fen } : {}), check: current.position.isCheck(), lastMove: temporary ? current.moves.at(-1)?.match(/.{2}/g)?.slice(0, 2) as Key[] | undefined : board.cgState().lastMove,
      drawable: { shapes, autoShapes: auto, brushes: { ...board.ground.state.drawable.brushes, engine: { key: 'engine', color: '#27854c', opacity: 0.75, lineWidth: 9 }, human: { key: 'human', color: '#9155c2', opacity: 0.9, lineWidth: 5 } } },
      turnColor: current.turn, movable: { free: false, color: current.turn, dests: chessgroundDests(current.position), events: { after: (from, to) => {
        const piece = current.position.board.get(parseSquare(from)!);
        if (piece?.role === 'pawn' && (to[1] === '1' || to[1] === '8')) { setPromotion({ from, to, position: current }); return; }
        try { setTemporary(appendMove(current, from, to)); } catch { board.toPath(board.path, false); }
      } } }, draggable: { enabled: true }, selectable: { enabled: true }, premovable: { enabled: false } });
  }, [temporary, display, analysisOptions.stockfish, analysisOptions.maia, engines]);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `Game review · ${game.white || game.event || game.source_title}`;
    const keydown = (event: KeyboardEvent) => {
      if (pieceMode) return; // Native Piece mode dialog owns Escape and focus.
      const target = event.target;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
        (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, dialog, [role="textbox"]')))) return;
      const board = viewer.current;
      switch (event.key) {
        case 'ArrowLeft': board?.goTo(event.shiftKey ? 'first' : 'prev', false); break;
        case 'ArrowRight': board?.goTo(event.shiftKey ? 'last' : 'next', false); break;
        case 'Home': case 'ArrowUp': board?.goTo('first', false); break;
        case 'End': case 'ArrowDown': board?.goTo('last', false); break;
        case 'f': case 'F': board?.flip(); break;
        case 'Escape': onClose(); break;
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
  }, [game.white, game.event, game.source_title, onClose, pieceMode]);
  useEffect(() => {
    const current = transcript.current?.querySelector('[aria-current="step"]');
    current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [path]);
  const move = model.data?.tokens.find(token => token.type === 'move' && token.path === path);
  const title = game.white || game.black ? `${game.white || 'Unknown'} vs ${game.black || 'Unknown'}` : game.event || 'Study position';
  const go = (direction: 'first' | 'prev' | 'next' | 'last') => viewer.current?.goTo(direction, false);
  const currentNode = viewer.current?.game.nodeAt(new Path(path));
  const renderToken = (token: ReviewToken, index: number) => {
    if (token.type === 'comment') return token.depth
      ? <span className="review-comment inline-comment" key={index}> {token.text} </span>
      : <p className="review-comment" key={index}>{token.text}</p>;
    if (token.type === 'variation-start') return <span className="review-variation" key={index} aria-label="Variation"> (</span>;
    if (token.type === 'variation-end') return <span className="review-variation-end" key={index}>) </span>;
    const ply = token.ply || 1;
    const number = `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'}`;
    const previous = model.data?.tokens[index - 1];
    const showNumber = ply % 2 === 1 || previous?.type !== 'move' || previous.depth !== token.depth;
    const evaluationNags = (token.nags || []).filter(nag => nag >= 10 && nag <= 21);
    const evaluations = [
      ...evaluationNags.map(nag => ({ value: annotationGlyphs[nag]?.symbol || (nag === 20 ? '+−' : '−+'),
        title: annotationGlyphs[nag]?.name || 'Decisive advantage' })),
      ...(token.evaluations || []).map(evaluation => ({ value: evaluation.value,
        title: evaluation.depth === undefined ? 'Position evaluation' : `Position evaluation · depth ${evaluation.depth}` })),
    ];
    return <button key={index} className={'review-move' + (token.depth ? ' in-variation' : '')}
      data-review-path={token.path} aria-current={token.path === path ? 'step' : undefined}
      title={token.path === null ? 'The source contains an illegal move; its text is preserved.' : `Go to ${number} ${token.san}`}
      disabled={!ready || token.path === null} onClick={() => viewer.current?.toPath(new Path(token.path!), false)}>
      {showNumber && <span className="review-move-number">{number} </span>}{token.san}
      {token.nags?.filter(nag => !evaluationNags.includes(nag)).map((nag, i) => <span className="review-glyph" title={annotationGlyphs[nag]?.name || `Annotation $${nag}`} key={i}>{annotationGlyphs[nag]?.symbol || `$${nag}`}</span>)}
      {evaluations.length > 0 && <small className="review-evaluation"> ({evaluations.map((evaluation, i) => <span title={evaluation.title} key={i}>{i > 0 ? ', ' : ''}{evaluation.value}</span>)})</small>}
      {token.annotated && <Compass size={12} aria-label="Board annotation" />}
    </button>;
  };
  const Shell = embedded ? 'div' : 'main';
  return <Shell className={"review-shell" + (game.opening?.name && !embedded ? " has-opening" : "") + (embedded ? " book-game-review" : "")}>
    {!embedded && <header className="review-header">
      <div>
        <div className="eyebrow">GAME REVIEW · {game.source_title}</div>
        <h1>{title}</h1>
        {game.opening?.name && <p className="review-opening-name" title={game.opening.name}>{game.opening.name} · {game.opening.eco}{game.eco && game.eco !== game.opening.eco ? ` · Source ECO ${game.eco}` : ''}</p>}
        <p>{[game.event, game.site, game.date, game.opening?.name ? null : game.eco, game.result].filter(value => value && value !== '?').join(' · ')}</p>
      </div>
      <button className="secondary-button" onClick={onClose} autoFocus><ArrowLeft size={16} /> Back to games</button>
    </header>}
    <div className="review-workspace">
      <section className="review-board" aria-label="Game review board">
        <div className={"analysis-board-frame" + (display.bar && analysisOptions.stockfish ? " with-bar" : "")}><PgnBoard pgn={game.pgn} review initialPath={initialPath} onReady={onReady} onPathChange={onPathChange} configureBoard={configureBoard} />{display.bar && analysisOptions.stockfish && <EvaluationBar state={engines.stockfish} enabled={analysisOptions.stockfish} flipped={flipped} />}</div>

        <div className="review-controls" role="group" aria-label="Move navigation">
          <button title="First position" aria-label="First position" disabled={!ready || !path} onClick={() => go('first')}><ChevronsLeft size={21} /></button>
          <button title="Previous move" aria-label="Previous move" disabled={!ready || !path} onClick={() => go('prev')}><ChevronLeft size={24} /></button>
          <span aria-live="polite">{move ? `${Math.ceil((move.ply || 1) / 2)}${(move.ply || 1) % 2 ? '.' : '…'} ${move.san}` : 'Starting position'}</span>
          <button title="Next move" aria-label="Next move" disabled={!ready || !currentNode?.children.length} onClick={() => go('next')}><ChevronRight size={24} /></button>
          <button title="Last mainline position" aria-label="Last mainline position" disabled={!ready || !viewer.current?.game.mainline.length} onClick={() => go('last')}><ChevronsRight size={21} /></button>
        </div>
        <p className="review-help">Select any move or variation to explore it. ← / → moves · Home / End first / last · F flips · Esc returns to games.</p>
        {game.start_fen && <details className="review-position"><summary>Starting position</summary><code>{game.start_fen}</code></details>}
      </section>
      <section className="review-score" aria-labelledby="review-score-title">
        <div className="piece-entry"><button disabled={!position || !!promotion} onClick={() => {
          if (position && viewer.current) setPieceMode({ fen: position.fen, orientation: viewer.current.orientation(), scroll: transcript.current?.scrollTop || 0, focus: document.activeElement instanceof HTMLElement ? document.activeElement : null });
        }}>Piece mode</button></div>
        <EnginePanel onFlip={() => viewer.current?.flip()} canFlip={ready} options={analysisOptions} setOptions={setAnalysisOptions} display={display} setDisplay={setDisplay} states={engines} position={position} onPreview={moves => { if (position) setTemporary(replayPosition(position.initialFen, moves)); }} />
        {temporary && <div className="analysis-branch"><span>Temporary analysis · {temporary.sans.slice(source?.moves.length || 0).join(' ')}</span> <button onClick={() => { setTemporary(null); viewer.current?.toPath(new Path(path), false); }}>Return to book position</button></div>}
        {promotion && <div className="promotion-choice" role="group" aria-label="Choose promotion">Promote to {(['queen', 'rook', 'bishop', 'knight'] as const).map(role => <button key={role} onClick={() => { setTemporary(appendMove(promotion.position, promotion.from, promotion.to, role)); setPromotion(null); }}>{role}</button>)}</div>}
        <div className="review-score-heading"><div className="eyebrow">THE ANNOTATED SCORE</div><h2 id="review-score-title">Moves & commentary</h2></div>
        <div className="review-transcript" ref={transcript}>
          {model.error && <div className="notice error">{model.error}</div>}
          {model.data?.positionError && <div className="notice error">{model.data.positionError}</div>}
          {score.map(({ tokens, index }) => tokens.length === 2
            ? <span className="review-move-pair" key={index}>{renderToken(tokens[0], index)}{renderToken(tokens[1], index + 1)}</span>
            : renderToken(tokens[0], index))}
          {game.result && game.result !== '*' && <p className="review-result">{game.result}</p>}
          <details className="review-headers"><summary>Game information · all PGN headers</summary><dl>
            {model.data?.headers.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || '—'}</dd></div>)}
          </dl></details>
          <details className="review-original"><summary>Original PGN</summary><pre>{game.pgn}</pre></details>
        </div>
      </section>
    </div>
    {pieceMode && <PieceMode fen={pieceMode.fen} orientation={pieceMode.orientation} onReturn={returnFromPieceMode} />}
  </Shell>;
}
