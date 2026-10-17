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
export function reviewPgn(pgn: string): {
  tokens: ReviewToken[];
  headers: Array<[string, string]>;
  displayPgn: string;
  positionError: string | null;
};
