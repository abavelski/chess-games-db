export interface ReviewNavigation {
  path: string;
  positionKey: string | null;
  notice: string | null;
}
export function resolveReviewNavigation(
  pgn: string,
  match: { path: string; ply: number; isMainline: true } | null,
  searchedFen: string,
  studyStops?: boolean,
): ReviewNavigation;
