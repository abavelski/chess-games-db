import type { Position } from 'chessops/chess';
import type { Viewer } from './PgnBoard';
export interface AnalysisPosition { initialFen: string; moves: string[]; fen: string; turn: 'white' | 'black'; sans: string[]; position: Position }
export function replayPosition(initialFen: string, moves: string[]): AnalysisPosition;
export function sourcePosition(viewer: Viewer): AnalysisPosition;
export function appendMove(current: AnalysisPosition, from: string, to: string, promotion?: 'queen' | 'rook' | 'bishop' | 'knight'): AnalysisPosition;
export function linePreview(current: AnalysisPosition, moves: string[]): Array<{ san: string; moves: string[] }>;
export function analysisKey(current: AnalysisPosition, engine: string, settings: unknown): string;
