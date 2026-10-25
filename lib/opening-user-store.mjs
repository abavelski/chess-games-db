import Database from 'better-sqlite3';
import { openingBoard } from '../src/opening-session.mjs';

const APPLICATION_ID = 1330926931;
const text = (v, max = 4096) => typeof v === 'string' && v.length <= max;
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new Error('Invalid opening state fields');
}
function route(v) {
  fields(v, ['mode','rootFen','moves','filters']);
  if (!v || !['prefix','position'].includes(v.mode) || !text(v.rootFen, 256) || !Array.isArray(v.moves)) throw new Error('Invalid saved opening route');
  openingBoard(v.rootFen, v.moves);
  const f = v.filters;
  if (!f || typeof f !== 'object' || Array.isArray(f) || Object.keys(f).some(k => !['roles','articleKeys','query','annotationLanguages'].includes(k))) throw new Error('Invalid opening filters');
  if (f.query !== undefined && !text(f.query, 256)) throw new Error('Invalid metadata filter');
  for (const k of ['roles','articleKeys','annotationLanguages']) if (f[k] !== undefined && (!Array.isArray(f[k]) || f[k].length > 32 || f[k].some(x => !text(x, 4096)))) throw new Error('Invalid saved filter');
  if (f.roles?.some(v => !['main_games','theory'].includes(v)) || f.annotationLanguages?.some(v => !/^[a-z]{2,3}$/.test(v))) throw new Error('Invalid saved source filter');
}
export function validateOpeningUserState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 131072) throw new Error('Opening settings exceed limits');
  if (Object.keys(value).some(k => !['language','workspace','session'].includes(k))) throw new Error('Unknown opening setting');
  if (value.language !== undefined && !['en','de','fr','es','it','nl','pt'].includes(value.language)) throw new Error('Invalid reading language');
  if (value.workspace !== undefined && !['games','openings'].includes(value.workspace)) throw new Error('Invalid workspace');
  if (value.session != null) {
    const s = value.session;
    fields(s, ['libraryUUID','revision','corpus','explorer','review']);
    if (![s.libraryUUID,s.revision,s.corpus].every(v => text(v, 256))) throw new Error('Missing saved library identity');
    if (s.explorer) {
      fields(s.explorer, ['route','kind','page','flipped','previous','articleView','articleReturnView','readerKeys','articleNames','scrolls']);
      route(s.explorer.route);
      if (!['games','articles','comments'].includes(s.explorer.kind) || !Number.isInteger(s.explorer.page) || s.explorer.page < 1 || s.explorer.page > 1000000 || typeof s.explorer.flipped !== 'boolean') throw new Error('Invalid saved material view');
      if (!['related','catalog','reader'].includes(s.explorer.articleView) || !Array.isArray(s.explorer.readerKeys) || s.explorer.readerKeys.length > 8 || s.explorer.readerKeys.some(e => !text(e.key) || !Number.isInteger(e.id))) throw new Error('Invalid saved article view');
      if (s.explorer.articleReturnView !== undefined && !['related','catalog'].includes(s.explorer.articleReturnView)) throw new Error('Invalid article return view');
      for (const e of s.explorer.readerKeys) fields(e, ['key','id']);
      const names = s.explorer.articleNames;
      if (!names || typeof names !== 'object' || Array.isArray(names) || Object.entries(names).some(([k, v]) => !text(k) || !text(v))) throw new Error('Invalid saved article names');
      const scrolls = s.explorer.scrolls;
      if (scrolls !== undefined && (!scrolls || typeof scrolls !== 'object' || Array.isArray(scrolls) || Object.entries(scrolls).some(([k, v]) => !text(k) || !Number.isFinite(v) || v < 0 || v > 10000000))) throw new Error('Invalid saved scroll');
      if (s.explorer.previous) {
        const p = s.explorer.previous; fields(p, ['route','page','kind','flipped']); route(p.route);
        if (!['games','articles','comments'].includes(p.kind) || !Number.isInteger(p.page) || p.page < 1 || p.page > 1000000 || typeof p.flipped !== 'boolean') throw new Error('Invalid previous opening view');
      }
    }
    if (s.review) {
      fields(s.review, ['key','treeHash','sourcePath','flipped']);
      if (!text(s.review.key) || !/^[a-f0-9]{64}$/.test(s.review.treeHash) || !text(s.review.sourcePath, 8192) || !/^(?:\d+(?:\.\d+)*)?$/.test(s.review.sourcePath) || typeof s.review.flipped !== 'boolean') throw new Error('Invalid saved source review');
    }
  }
  return JSON.parse(JSON.stringify(value));
}

// DELETE journalling keeps this small, independent backup a single SQLite file
// after each committed write. It never opens a game archive or runtime library.
export class OpeningUserStore {
  constructor(path) {
    this.db = new Database(path);
    try {
      const id = this.db.pragma('application_id', { simple: true }), version = this.db.pragma('user_version', { simple: true });
      if (id === 0 && version === 0 && this.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n === 0) {
        this.db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1; CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL CHECK(json_valid(value))); INSERT INTO settings VALUES(1,'{}');`);
      } else if (id !== APPLICATION_ID || version !== 1) throw new Error('Unsupported opening user store');
      this.db.pragma('journal_mode=DELETE'); this.db.pragma('synchronous=FULL');
      this.read();
    } catch (error) { this.db.close(); throw error; }
  }
  read() { return validateOpeningUserState(JSON.parse(this.db.prepare('SELECT value FROM settings WHERE id=1').get().value)); }
  patch(value) {
    validateOpeningUserState(value);
    return this.db.transaction(() => {
      const next = validateOpeningUserState({ ...this.read(), ...value });
      this.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(next));
      return next;
    })();
  }
  close() { this.db.close(); }
}
