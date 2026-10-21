import { Fragment, memo, useMemo } from 'react';
import { Compass, Eye, Medal } from 'lucide-react';
import { glyphs } from '@lichess-org/pgn-viewer/view/glyph';
import { reviewLayout, type ScoreToken, type ScoreVariation } from './review-layout.mjs';
import { nagDescription, nonStandardNagGlyphs } from './nag-descriptions.mjs';
import { medalName, medalDescription } from './medal-descriptions';
import type { ReviewToken } from './pgn.mjs';

const annotationGlyphs: Record<number, { symbol: string; name: string }> = {
  ...glyphs,
  ...nonStandardNagGlyphs,
  11: { symbol: '=', name: 'Equal chances, quiet position' },
  12: { symbol: '=', name: 'Equal chances, active position' },
  20: { symbol: '+−', name: '' },
  21: { symbol: '−+', name: '' },
};
export const ReviewMoves = memo(function ReviewMoves({ tokens, path, ready, onSelect, revealPath, revealToEnd, onReveal, showGlyphDescriptions = false, ownPaths, personalComments, onEditComment }: {
  onEditComment?: (path: string) => void;
  ownPaths?: Set<string>; personalComments?: Map<string, string>;
  showGlyphDescriptions?: boolean;
  revealPath?: string; revealToEnd?: boolean; onReveal?: () => void;
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
    const description = (nag: number) => nagDescription(nag) ?? annotationGlyphs[nag]?.name ?? `Annotation $${nag} (not defined in the PGN specification)`;
    const evaluationNags = (token.nags || []).filter(nag => nag >= 10 && nag <= 21);
    const evaluations = [
      ...evaluationNags.map(nag => ({ value: annotationGlyphs[nag]?.symbol || (nag === 20 ? '+−' : '−+'), title: description(nag), description: description(nag) })),
      ...(token.evaluations || []).map(evaluation => ({ value: evaluation.value, title: evaluation.depth === undefined ? 'Position evaluation' : `Position evaluation · depth ${evaluation.depth}`, description: undefined })),
    ];
    const moveButton = <button key={index} className={'review-move' + (token.depth ? ' in-variation' : '') + (token.path && ownPaths?.has(token.path) ? ' personal-move' : '')}
      data-review-path={token.path} aria-current={token.path === path ? 'step' : undefined}
      title={token.path === null ? 'The source contains an illegal move; its text is preserved.' : `Go to ${number} ${token.san}`}
      disabled={!ready || token.path === null} onClick={() => onSelect(token.path!)}>
      {showNumber && <span className="review-move-number">{number} </span>}{token.san}
      {token.nags?.filter(nag => !evaluationNags.includes(nag)).map((nag, i) => <Fragment key={i}><span className="review-glyph" title={description(nag)} aria-label={description(nag)}>{annotationGlyphs[nag]?.symbol || `$${nag}`}</span>{showGlyphDescriptions && <small className="review-glyph-description"> ({description(nag)})</small>}</Fragment>)}
      {evaluations.length > 0 && <small className="review-evaluation"> ({evaluations.map((evaluation, i) => <span title={evaluation.title} aria-label={evaluation.title} key={i}>{i > 0 ? ', ' : ''}{evaluation.value}{showGlyphDescriptions && evaluation.description && <span className="review-glyph-description"> ({evaluation.description})</span>}</span>)})</small>}
      {token.annotated && <Compass size={12} aria-label="Board annotation" />}
      {token.critical?.map(phase => <span key={phase} className={`review-critical review-critical-${phase}`}
        role="img" aria-label={`Critical ${phase} position`} title={`Critical ${phase} position`}>◆</span>)}
      {!!token.medals?.length && <span className="review-medal" role="img" aria-label={`Medals: ${token.medals.map(medalDescription).join('; ')}`} title={token.medals.map(medalDescription).join('\n')}><Medal size={13} aria-hidden="true" /><span>{token.medals.map(medalName).join(', ')}</span></span>}
    </button>;
    const withComment = token.path && personalComments?.has(token.path) ? <span className="review-move-with-comment" key={index}>{moveButton}<button type="button" className="review-comment inline-comment personal-comment" title="Edit comment" aria-label={`Edit comment: ${personalComments.get(token.path)}`} disabled={!ready} onClick={() => onEditComment?.(token.path!)}> {personalComments.get(token.path)} </button></span> : moveButton;
    if (token.path !== revealPath || !onReveal) return withComment;
    const explanation = `Reveal ${revealToEnd ? 'the rest of the game' : 'up to the next critical position or medal'} without moving the board. Use the arrows to navigate moves.`;
    return <span className="review-move-with-reveal" key={index}>{withComment}<button type="button" className="review-reveal-button"
      aria-label="Reveal next section" title={explanation} disabled={!ready} onClick={onReveal}><Eye size={14} aria-hidden="true" /></button></span>;
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
  return <div className={"review-moves" + (showGlyphDescriptions ? " show-glyph-descriptions" : "")}>
    {personalComments?.has('') && <button type="button" className="review-comment personal-comment root-personal-comment" title="Edit comment" aria-label="Edit starting-position comment" disabled={!ready} onClick={() => onEditComment?.('')}>{personalComments.get('')}</button>}
    {layout.map(item => item.type === 'variation' ? renderVariation(item) : item.type === 'token' ? renderToken(item.token, item.index) : <div className="review-mainline-row review-move-pair" key={item.index}>
      <span className="review-row-number">{item.number}.</span>
      {item.white ? renderToken(item.white.token, item.white.index, true) : <span className="review-empty-move" aria-hidden="true">…</span>}
      {item.black ? renderToken(item.black.token, item.black.index, true) : <span className="review-empty-move" aria-hidden="true" />}
    </div>)}
  </div>;
});
