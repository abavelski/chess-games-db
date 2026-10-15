import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Compass } from 'lucide-react';
import { Path } from '@lichess-org/pgn-viewer/path';
import { glyphs } from '@lichess-org/pgn-viewer/view/glyph';
import { PgnBoard, type Viewer } from './PgnBoard';
import { reviewPgn } from './pgn.mjs';
import type { GameDetail } from './types';

const annotationGlyphs: Record<number, { symbol: string; name: string }> = {
  ...glyphs,
  11: { symbol: '=', name: 'Equal chances, quiet position' },
  12: { symbol: '=', name: 'Equal chances, active position' },
};

function Review({ game, initialPath }: { game: GameDetail; initialPath: string }) {
  const viewer = useRef<Viewer | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState(initialPath);
  const [ready, setReady] = useState(false);
  const model = useMemo(() => {
    try { return { data: reviewPgn(game.pgn), error: null }; }
    catch (error) { return { data: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [game.pgn]);
  const onReady = useCallback((value: Viewer | null) => {
    viewer.current = value; setReady(!!value);
    if (value) setPath(value.path.path);
  }, []);
  const onPathChange = useCallback((value: string) => setPath(value), []);
  useEffect(() => {
    const current = transcript.current?.querySelector('[aria-current="step"]');
    current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [path]);
  const move = model.data?.tokens.find(token => token.type === 'move' && token.path === path);
  const title = game.white || game.black ? `${game.white || 'Unknown'} vs ${game.black || 'Unknown'}` : game.event || 'Study position';
  const go = (direction: 'first' | 'prev' | 'next' | 'last') => viewer.current?.goTo(direction, false);
  const currentNode = viewer.current?.game.nodeAt(new Path(path));
  return <main className="review-shell">
    <header className="review-header">
      <div>
        <div className="eyebrow">GAME REVIEW · {game.source_title}</div>
        <h1>{title}</h1>
        <p>{[game.event, game.site, game.date, game.eco, game.result].filter(value => value && value !== '?').join(' · ')}</p>
      </div>
      <button className="secondary-button" onClick={() => void window.chessArchive.closeReview()}><ArrowLeft size={16} /> Back to library</button>
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
        <p className="review-help">Select any move or variation to explore it. Focus the board to use ← / →. Colored arrows and squares follow the selected position.</p>
        {game.start_fen && <details className="review-position"><summary>Starting position</summary><code>{game.start_fen}</code></details>}
      </section>
      <section className="review-score" aria-labelledby="review-score-title">
        <div className="review-score-heading"><div className="eyebrow">THE ANNOTATED SCORE</div><h2 id="review-score-title">Moves & commentary</h2></div>
        <div className="review-transcript" ref={transcript}>
          {model.error && <div className="notice error">{model.error}</div>}
          {model.data?.positionError && <div className="notice error">{model.data.positionError}</div>}
          {model.data?.tokens.map((token, index) => {
            const style = { marginLeft: Math.min(token.depth, 5) * 14 };
            if (token.type === 'comment') return <p className="review-comment" key={index} style={style}>{token.text}</p>;
            if (token.type === 'variation-start') return <div className="review-variation" key={index} style={style}>Variation</div>;
            if (token.type === 'variation-end') return <div className="review-variation-end" key={index} />;
            const ply = token.ply || 1;
            const number = `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'}`;
            return <button key={index} className={'review-move' + (token.depth ? ' in-variation' : '')}
              data-review-path={token.path} aria-current={token.path === path ? 'step' : undefined}
              title={token.path === null ? 'The source contains an illegal move; its text is preserved.' : `Go to ${number} ${token.san}`}
              disabled={!ready || token.path === null} onClick={() => viewer.current?.toPath(new Path(token.path!), false)}>
              <span className="review-move-number">{number}</span> {token.san}
              {token.nags?.map((nag, i) => <span className="review-glyph" title={annotationGlyphs[nag]?.name || `Annotation $${nag}`} key={i}>{annotationGlyphs[nag]?.symbol || `$${nag}`}</span>)}
              {token.annotated && <Compass size={12} aria-label="Board annotation" />}
            </button>;
          })}
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

export function GameReview() {
  const [review, setReview] = useState<{ game: GameDetail; initialPath: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    window.chessArchive.getReview().then(value => {
      if (!alive) return;
      if (value) setReview(value);
      else setError('This review is no longer available. Reopen it from the library.');
    }).catch(error => { if (alive) setError(String(error)); });
    return () => { alive = false; };
  }, []);
  if (error) return <main className="review-shell"><div className="notice error">{error}</div></main>;
  return review ? <Review {...review} /> : <main className="review-shell" aria-busy="true">Opening game review…</main>;
}
