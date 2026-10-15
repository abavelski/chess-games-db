import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Compass } from 'lucide-react';
import { Path } from '@lichess-org/pgn-viewer/path';
import { glyphs } from '@lichess-org/pgn-viewer/view/glyph';
import { PgnBoard, type Viewer } from './PgnBoard';
import { reviewPgn, type ReviewToken } from './pgn.mjs';
import type { GameDetail } from './types';

const annotationGlyphs: Record<number, { symbol: string; name: string }> = {
  ...glyphs,
  11: { symbol: '=', name: 'Equal chances, quiet position' },
  12: { symbol: '=', name: 'Equal chances, active position' },
};

export function GameReview({ game, initialPath, onClose }: { game: GameDetail; initialPath: string; onClose: () => void }) {
  const viewer = useRef<Viewer | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState(initialPath);
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
  const onPathChange = useCallback((value: string) => setPath(value), []);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `Game review · ${game.white || game.event || game.source_title}`;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
        (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]')))) return;
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
  }, [game.white, game.event, game.source_title, onClose]);
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
      ? <span className="review-comment inline-comment" key={index}> {'{'} {token.text} {'}'} </span>
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
  return <main className="review-shell">
    <header className="review-header">
      <div>
        <div className="eyebrow">GAME REVIEW · {game.source_title}</div>
        <h1>{title}</h1>
        <p>{[game.event, game.site, game.date, game.eco, game.result].filter(value => value && value !== '?').join(' · ')}</p>
      </div>
      <button className="secondary-button" onClick={onClose} autoFocus><ArrowLeft size={16} /> Back to library</button>
    </header>
    <div className="review-workspace">
      <section className="review-board" aria-label="Game review board">
        <PgnBoard pgn={game.pgn} review initialPath={initialPath} onReady={onReady} onPathChange={onPathChange} />
        <div className="review-controls" role="group" aria-label="Move navigation">
          <button title="First position" aria-label="First position" disabled={!ready || !path} onClick={() => go('first')}><ChevronsLeft size={21} /></button>
          <button title="Previous move" aria-label="Previous move" disabled={!ready || !path} onClick={() => go('prev')}><ChevronLeft size={24} /></button>
          <span aria-live="polite">{move ? `${Math.ceil((move.ply || 1) / 2)}${(move.ply || 1) % 2 ? '.' : '…'} ${move.san}` : 'Starting position'}</span>
          <button title="Next move" aria-label="Next move" disabled={!ready || !currentNode?.children.length} onClick={() => go('next')}><ChevronRight size={24} /></button>
          <button title="Last mainline position" aria-label="Last mainline position" disabled={!ready || !viewer.current?.game.mainline.length} onClick={() => go('last')}><ChevronsRight size={21} /></button>
          <button title="Flip board" aria-label="Flip board" disabled={!ready} onClick={() => viewer.current?.flip()}><ArrowLeftRight size={20} /></button>
        </div>
        <p className="review-help">Select any move or variation to explore it. ← / → moves · Home / End first / last · F flips · Esc returns to library.</p>
        {game.start_fen && <details className="review-position"><summary>Starting position</summary><code>{game.start_fen}</code></details>}
      </section>
      <section className="review-score" aria-labelledby="review-score-title">
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
  </main>;
}
