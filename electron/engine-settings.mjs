import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { engineDefaults, validateSettings } from './engines.mjs';

export function loadEngineSettings(app) {
  const candidates = [join(app.getPath('userData'), 'engines.json')];
  if (!app.isPackaged) candidates.push(fileURLToPath(new URL('../.local-engines/engines.json', import.meta.url)));
  for (const candidate of candidates) {
    try { return validateSettings(JSON.parse(readFileSync(candidate, 'utf8'))); }
    catch { /* First launch or invalid settings: try the development profile. */ }
  }
  return { ...engineDefaults };
}
