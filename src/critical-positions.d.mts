import type { ReviewToken } from './pgn.mjs';
export function criticalNavigation(tokens: ReviewToken[], path: string): {
  total: number;
  current: number;
  previous: string | null;
  next: string | null;
};
