export function normalizeLanguage(language: string | null): string | null;
export function preferredLanguageVersion<T extends { language: string | null }>(versions: T[]): T | undefined;
