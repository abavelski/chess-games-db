import { useCallback, useMemo, useRef } from 'react';
import { GameReview } from './GameReview';
import { openingReviewGame, sourceReviewPath, reviewSourcePath } from './opening-review.mjs';
import type { OpeningStudy } from './opening-types';
const noop = () => {};
export function OpeningGameReview({ study, notice, onClose, active, initialFlipped, onPosition }: {
  study: OpeningStudy; notice?: string; onClose: () => void; active: boolean;
  initialFlipped: boolean; onPosition: (path: string, flipped: boolean) => void;
}) {
  const game = useMemo(() => openingReviewGame(study), [study]);
  const sourcePaths = useMemo(() => new Set(study.nodes.map(node => node.sourcePath)), [study]);
  const lastPosition = useRef({ path: study.matchPath, flipped: initialFlipped });
  const position = useCallback((path: string, flipped: boolean) => {
    let sourcePath = reviewSourcePath(path);
    while (!sourcePaths.has(sourcePath)) sourcePath = sourcePath.split('.').slice(0, -1).join('.');
    const previous = lastPosition.current;
    if (previous.path === sourcePath && previous.flipped === flipped) return;
    lastPosition.current = { path: sourcePath, flipped };
    onPosition(sourcePath, flipped);
  }, [onPosition, sourcePaths]);
  return <GameReview game={game} initialPath={sourceReviewPath(study.matchPath)} sourceReview
    initialFlipped={initialFlipped} onReviewPosition={position} suspended={!active}
    navigationNotice={study.notice || notice} onClose={onClose} onFindPosition={noop}
    onPersonalSaved={noop} onToggleFavourite={noop} savingFavourite={false} favouriteError={null}
    reviewTools={<p className="opening-provenance">{study.annotator ? `Annotations: ${study.annotator}. ` : ''}Annotation coverage: {study.annotationCoverage}.</p>} />;
}
