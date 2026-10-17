import type { ReviewToken } from './pgn.mjs';
export interface ScoreToken { type: 'token'; token: ReviewToken; index: number }
export interface ScoreVariation { type: 'variation'; index: number; depth: number; items: Array<ScoreToken | ScoreVariation>; end: number | null }
export interface ScoreRow { type: 'row'; index: number; number: number; white: ScoreToken | null; black: ScoreToken | null }
export function reviewLayout(tokens: ReviewToken[]): Array<ScoreToken | ScoreVariation | ScoreRow>;
