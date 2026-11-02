import type { AnalysisPosition } from './analysis.mjs';
import type { Candidate } from './engine-types';
export function startPieceGame(originalFen: string, pieces: string, turn: 'white' | 'black', touched?: number[]): AnalysisPosition;
export function chooseMaiaMove(current: AnalysisPosition, candidates: Candidate[], random?: () => number): AnalysisPosition;
export function pieceGameResult(current: AnalysisPosition): { ended: boolean; text: string; claim: string | null };
