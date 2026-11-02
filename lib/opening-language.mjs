const languages = {
  ENGLISH: 'en', ENG: 'en', GERMAN: 'de', GER: 'de', DEU: 'de',
  FRENCH: 'fr', FRA: 'fr', FRE: 'fr', SPANISH: 'es', ESP: 'es', SPA: 'es',
  ITALIAN: 'it', ITA: 'it', DUTCH: 'nl', NED: 'nl', DUT: 'nl', NLD: 'nl',
  PORTUGUESE: 'pt', POR: 'pt', RUSSIAN: 'ru', RUS: 'ru', UNKNOWN: 'und',
};
export const normalizeLanguage = language => language == null ? null : languages[language] ?? language.toLowerCase();

// Source order is the stable tie-breaker within a language and for other languages.
export const preferredLanguageVersion = versions => versions.find(v => v.language === 'en')
  ?? versions.find(v => v.language === 'ru') ?? versions[0];
