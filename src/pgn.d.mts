export interface ReviewToken {
  type: 'comment' | 'move' | 'variation-start' | 'variation-end';
  depth: number;
  text?: string;
  san?: string;
  path?: string | null;
  ply?: number;
  nags?: number[];
  evaluations?: Array<{ value: string; depth?: number }>;
  annotated?: boolean;
  medals?: string[];
  critical?: Array<'opening' | 'middlegame' | 'endgame'>;
}
export function commentText(comment: string, keepBoardAnnotations?: boolean): string;
export function prepareDisplayPgn(pgn: string): string;
export function reviewPgn(pgn: string, ordinalPaths?: boolean): {
  tokens: ReviewToken[];
  headers: Array<[string, string]>;
  displayPgn: string;
  positionError: string | null;
};

export function ordinalPathPart(index: number): string;
export function assignOrdinalPaths<T extends import('@lichess-org/pgn-viewer/game').Game>(game: T, Path: typeof import('@lichess-org/pgn-viewer/path').Path): T;

export function extendReviewLine(pgn: string, selectedPath: string, moves: string[]): { pgn: string; path: string };
