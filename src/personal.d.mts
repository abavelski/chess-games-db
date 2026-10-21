import type { PersonalAnalysis } from './types';
import type { Position } from 'chessops/position';
export function emptyPersonal(): PersonalAnalysis;
export function personalPath(initial: Position, moves: string[]): string;
export function mergePersonal(pgn: string, personal?: PersonalAnalysis): { pgn: string; ownPaths: Set<string>; comments: Map<string, string> };
export function validatePersonal(value: unknown, pgn: string): PersonalAnalysis;

import type { ReviewToken } from './pgn.mjs';
export function personalReviewTokens(tokens: ReviewToken[], ownPaths: Set<string>, revealed: { tokens: ReviewToken[]; allowedPaths: Set<string> }): ReviewToken[];

export function updatePersonalComment(personal: PersonalAnalysis, moves: string[], text: string): PersonalAnalysis;
export function removePersonalMove(pgn: string, personal: PersonalAnalysis, moves: string[]): PersonalAnalysis;
