import { memo, useMemo } from 'react';
import { Compass } from 'lucide-react';
import { glyphs } from '@lichess-org/pgn-viewer/view/glyph';
import { reviewLayout, type ScoreToken, type ScoreVariation } from './review-layout.mjs';
import type { ReviewToken } from './pgn.mjs';

const annotationGlyphs: Record<number, { symbol: string; name: string }> = {
  ...glyphs,
  11: { symbol: '=', name: 'Equal chances, quiet position' },
  12: { symbol: '=', name: 'Equal chances, active position' },
};
export const ReviewMoves = memo(function ReviewMoves({ tokens, path, ready, onSelect }: {
  tokens: ReviewToken[]; path: string; ready: boolean; onSelect: (path: string) => void;
}) {
  const layout = useMemo(() => reviewLayout(tokens), [tokens]);
  const renderToken = (token: ReviewToken, index: number, mainline = false) => {
    if (token.type === 'comment') return token.depth
      ? <span className="review-comment inline-comment" key={index}> {token.text} </span>
      : <p className="review-comment" key={index}>{token.text}</p>;
    if (token.type !== 'move') return null;
    const ply = token.ply || 1;
    const number = `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'}`;
    const previous = tokens[index - 1];
    const showNumber = !mainline && (ply % 2 === 1 || previous?.type !== 'move' || previous.depth !== token.depth);
    const evaluationNags = (token.nags || []).filter(nag => nag >= 10 && nag <= 21);
    const evaluations = [
      ...evaluationNags.map(nag => ({ value: annotationGlyphs[nag]?.symbol || (nag === 20 ? '+−' : '−+'), title: annotationGlyphs[nag]?.name || 'Decisive advantage' })),
      ...(token.evaluations || []).map(evaluation => ({ value: evaluation.value, title: evaluation.depth === undefined ? 'Position evaluation' : `Position evaluation · depth ${evaluation.depth}` })),
    ];
    return <button key={index} className={'review-move' + (token.depth ? ' in-variation' : '')}
      data-review-path={token.path} aria-current={token.path === path ? 'step' : undefined}
      title={token.path === null ? 'The source contains an illegal move; its text is preserved.' : `Go to ${number} ${token.san}`}
      disabled={!ready || token.path === null} onClick={() => onSelect(token.path!)}>
      {showNumber && <span className="review-move-number">{number} </span>}{token.san}
      {token.nags?.filter(nag => !evaluationNags.includes(nag)).map((nag, i) => <span className="review-glyph" title={annotationGlyphs[nag]?.name || `Annotation $${nag}`} key={i}>{annotationGlyphs[nag]?.symbol || `$${nag}`}</span>)}
      {evaluations.length > 0 && <small className="review-evaluation"> ({evaluations.map((evaluation, i) => <span title={evaluation.title} key={i}>{i > 0 ? ', ' : ''}{evaluation.value}</span>)})</small>}
      {token.critical?.map(phase => <span key={phase} className={`review-critical review-critical-${phase}`}
        role="img" aria-label={`Critical ${phase} position`} title={`Critical ${phase} position`}>◆</span>)}
      {token.annotated && <Compass size={12} aria-label="Board annotation" />}
    </button>;
  };
  const renderVariation = (item: ScoreVariation): React.ReactNode => <div className="review-variation-line" data-depth={item.depth} role="group" aria-label="Variation" key={item.index}>
    <span className="review-variation" aria-hidden="true">(</span>
    {item.items.map((child, index) => {
      if (child.type === 'variation') return renderVariation(child);
      const next = item.items[index + 1];
      const previous = item.items[index - 1];
      if (child.token.type === 'move' && child.token.ply! % 2 === 0 && previous?.type === 'token' && previous.token.type === 'move' && previous.token.ply === child.token.ply! - 1) return null;
      const paired = child.token.type === 'move' && child.token.ply! % 2 === 1 && next?.type === 'token' && next.token.type === 'move' && next.token.ply === child.token.ply! + 1;
      return paired ? <span className="review-move-pair" key={child.index}>{renderToken(child.token, child.index)}{renderToken((next as ScoreToken).token, next!.index)}</span> : renderToken(child.token, child.index);
    })}
    <span className="review-variation-end" aria-hidden="true">)</span>
  </div>;
  return <div className="review-moves">
    {layout.map(item => item.type === 'variation' ? renderVariation(item) : item.type === 'token' ? renderToken(item.token, item.index) : <div className="review-mainline-row review-move-pair" key={item.index}>
      <span className="review-row-number">{item.number}.</span>
      {item.white ? renderToken(item.white.token, item.white.index, true) : <span className="review-empty-move" aria-hidden="true">…</span>}
      {item.black ? renderToken(item.black.token, item.black.index, true) : <span className="review-empty-move" aria-hidden="true" />}
    </div>)}
  </div>;
});
