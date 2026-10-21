import { extractMainlinePositions } from '../lib/position-mainline.mjs';
import { positionFingerprint } from '../lib/position-hash.mjs';
import { criticalReveal } from './critical-positions.mjs';
import { reviewPgn } from './pgn.mjs';

// An index is derived data, not authority for the board. Replay the original
// PGN and verify its exact four-field position key, not just the indexed ply.
export function resolveReviewNavigation(pgn, match, searchedFen, studyStops = false) {
  const fallback = reason => ({ path: '', positionKey: null, notice: reason });
  if (!match || match.isMainline !== true || typeof match.path !== 'string' ||
      !Number.isSafeInteger(match.ply) || match.ply < 0) {
    return fallback('The indexed match is missing or invalid. Opened at game start.');
  }
  try {
    const positionKey = positionFingerprint(searchedFen).verificationKey;
    const replay = extractMainlinePositions(pgn);
    if (replay.status !== 'complete') {
      return fallback('The original PGN could not be verified against the position index. Opened at game start.');
    }
    // PS-05 promises the earliest mainline occurrence (ply, then path).
    // An out-of-date later occurrence must not override that preference.
    const earliest = replay.occurrences.find(item => item.verificationKey === positionKey);
    if (!earliest || earliest.path !== match.path || earliest.ply !== match.ply) {
      return fallback('The indexed move no longer matches this position in the original PGN. Opened at game start.');
    }
    if (studyStops && earliest.path) {
      // Enter at stage zero, so opening a search result never skips unseen
      // critical/medal markers or reveals hidden book continuations.
      const reveal = criticalReveal(reviewPgn(pgn).tokens, 0, true);
      if (reveal.paused && !reveal.allowedPaths.has(earliest.path)) {
        let path = earliest.path;
        while (path && !reveal.allowedPaths.has(path)) path = path.slice(0, -2);
        return {
          path,
          positionKey: null, // The revealed ancestor is not the searched position.
          notice: 'Study stops hides the matching position. Opened at the nearest revealed mainline move instead; reveal further study stops to continue.',
        };
      }
    }
    return { path: earliest.path, positionKey, notice: null };
  } catch {
    return fallback('The indexed position could not be verified against the original PGN. Opened at game start.');
  }
}

// Used after the Lichess viewer mounts to verify the *actual* board as well as
// the original PGN. Keep exact-position semantics in one shared implementation.
export function reviewPositionKey(position) {
  return positionFingerprint(position).verificationKey;
}
