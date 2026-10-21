import type { Chess } from 'chessops/chess';
import type { Role, Color } from 'chessops/types';

export const INITIAL_POSITION_FEN: string;
export const POSITION_FILES: string;
export interface PositionBoardState {
  initialFen: string;
  moves: string[];
  fen: string;
  turn: Color;
  sans: string[];
  position: Chess;
}
export interface PositionSearchSetup { initialFen: string; moves: string[] }
export function positionBoard(moves?: string[], initialFen?: string): PositionBoardState;
export function positionPiece(board: PositionBoardState, square: string): { color: Color; role: Role } | undefined;
export function positionLegalTargets(board: PositionBoardState, from: string): string[];
export function positionNeedsPromotion(board: PositionBoardState, from: string, to: string): boolean;
export function playPositionMove(moves: string[], from: string, to: string, promotion?: Role, initialFen?: string): string[];
