export const nagDescriptions: readonly string[];
export const nonStandardNagGlyphs: Readonly<Partial<Record<number, Readonly<{ symbol: string; name: string }>>>>;
export function nagDescription(nag: number): string | undefined;
