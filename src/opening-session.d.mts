import type { Chess } from 'chessops/chess';
import type { Color } from 'chessops/types';
import type { OpeningRoute } from './opening-types';
export const OPENING_START_FEN: string;
export function openingBoard(initialFen?: string, moves?: string[]): { position: Chess; sans: string[]; fen: string; turn: Color; exactKey: string };
export function appendOpeningMove(route: OpeningRoute, uci: string): OpeningRoute;
export function openingAnchor(route: OpeningRoute, fen: string): OpeningRoute;
