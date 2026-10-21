import { extractMainlinePositions, extractAllPositions } from '../lib/position-mainline.mjs';
import { parseSearchPosition, positionFingerprint } from '../lib/position-hash.mjs';
import { criticalReveal } from './critical-positions.mjs';
import { reviewPgn } from './pgn.mjs';

// An index is derived data, not authority for the board. Replay the original
// PGN and verify its exact four-field position key, not just the indexed ply.
export function resolveReviewNavigation(pgn, match, searchedFen, studyStops = false) {
  const fallback = reason => ({ path: '', positionKey: null, notice: reason });
  if (!match || typeof match.isMainline !== 'boolean' || typeof match.path !== 'string' ||
      !Number.isSafeInteger(match.ply) || match.ply < 0 ||
      (match.type !== undefined && match.type !== (match.isMainline ? 'playedGame' : 'sourceVariation'))) {
    return fallback('The indexed match is missing or invalid. Opened at game start.');
  }
  try {
    const positionKey = positionFingerprint(searchedFen).verificationKey;
    const replay = match.isMainline ? extractMainlinePositions(pgn) : extractAllPositions(pgn);
    if (replay.status !== 'complete') {
      return fallback('The original PGN could not be verified against the position index. Opened at game start.');
    }
    // Match the SQL preference: played mainline first, then earliest ply,
    // shortest and lexically stable path. Reject stale or superseded hits.
    const earliest = replay.occurrences.filter(item => item.verificationKey === positionKey)
      .sort((a, b) => b.is_mainline - a.is_mainline || a.ply - b.ply ||
        a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))[0];
    if (!earliest || earliest.path !== match.path || earliest.ply !== match.ply ||
        Boolean(earliest.is_mainline) !== match.isMainline) {
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
          notice: 'Study stops hides the matching position. Opened at the nearest revealed move instead; reveal further study stops to continue.',
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

// PS-11: use the chessops position reconstructed by the actual review viewer,
// including its active source or saved personal branch. The Polyglot four-field
// key preserves pseudo-legal en passant metadata; a display-only FEN may not.
export function reviewedSearchFen(analysisPosition) {
  if (!analysisPosition || !analysisPosition.position || !Array.isArray(analysisPosition.moves)) {
    throw new Error('No legal review position is selected');
  }
  const fen = positionFingerprint(analysisPosition.position).verificationKey;
  // Verify the outbound FEN against the same strict contract used by IPC.
  parseSearchPosition(fen);
  return fen;
}
