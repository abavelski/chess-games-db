import type { OpeningStudy } from './opening-types';
import type { ReviewGame } from './GameReview';
export function sourceReviewPath(path: string): string;
export function reviewSourcePath(path: string): string;
export function openingReviewGame(study: OpeningStudy, language: string, allLanguages?: boolean): ReviewGame;
