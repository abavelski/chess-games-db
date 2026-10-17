import type { ReviewToken } from './pgn.mjs';
export function criticalNavigation(tokens: ReviewToken[], path: string): {
  total: number;
  current: number;
  previous: string | null;
  next: string | null;
};
export function criticalReveal(tokens: ReviewToken[], stage?: number, enabled?: boolean): {
  tokens: ReviewToken[];
  paused: boolean;
  path: string;
  allowedPaths: Set<string>;
};
export function criticalRevealStage(tokens: ReviewToken[], path: string): number;
