import type { Position } from 'chessops/chess';
import type { AnalysisPosition } from './analysis.mjs';
export interface ReviewNavigation {
  path: string;
  positionKey: string | null;
  notice: string | null;
}
export function resolveReviewNavigation(
  pgn: string,
  match: { path: string; ply: number; isMainline: boolean; type?: 'playedGame' | 'sourceVariation' } | null,
  searchedFen: string,
  studyStops?: boolean,
): ReviewNavigation;

export function reviewPositionKey(position: Position): string;

export function reviewedSearchFen(current: AnalysisPosition | null): string;
