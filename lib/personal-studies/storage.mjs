import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const APPLICATION_ID = 0x50535444;
export const SCHEMA_VERSION = 1;
export const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Deliberately independent of every archive/opening migration.
const schema = `
CREATE TABLE studies (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('tournament','other')),
 root_fen TEXT NOT NULL, pgn TEXT NOT NULL,
 white TEXT, black TEXT, white_elo INTEGER, black_elo INTEGER, event TEXT, site TEXT,
 date TEXT, round TEXT, result TEXT, eco TEXT, annotator TEXT, year INTEGER,
 origin_kind TEXT, origin_url TEXT,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE study_tags (
 study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
 tag_key TEXT NOT NULL, label TEXT NOT NULL, PRIMARY KEY(study_id,tag_key)
);
CREATE INDEX studies_updated_idx ON studies(updated_at DESC,id);
CREATE INDEX studies_year_idx ON studies(year,id);
CREATE INDEX studies_kind_idx ON studies(kind,id);
CREATE INDEX studies_white_idx ON studies(white,id);
CREATE INDEX studies_black_idx ON studies(black,id);
CREATE INDEX studies_event_idx ON studies(event,id);
CREATE INDEX study_tags_tag_idx ON study_tags(tag_key,study_id);
`;

export class PersonalStudiesStore {
  constructor(path) { this.path = path; this.db = null; }

  open() {
    if (this.db) return this.db;
    let db;
    try {
      const existing = existsSync(this.path);
      if (existing) {
        // Validate read-only first, before WAL or any migration may modify it.
        db = new Database(this.path, { readonly: true, fileMustExist: true });
        if (db.pragma('application_id', { simple: true }) !== APPLICATION_ID) throw new Error('This is not a personal studies database. Restore a verified studies backup.');
        const version = db.pragma('user_version', { simple: true });
        if (version !== SCHEMA_VERSION) throw new Error(`Unsupported personal studies schema ${version}. Use a compatible app version or restore a verified backup.`);
        if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Personal studies database is corrupt. Restore a verified backup.');
        db.prepare('SELECT id,pgn,revision FROM studies LIMIT 0').all();
        db.prepare('SELECT study_id,tag_key,label FROM study_tags LIMIT 0').all();
        db.close(); db = null;
      } else mkdirSync(dirname(this.path), { recursive: true });
      db = new Database(this.path);
      db.pragma('foreign_keys=ON');
      if (!existing) db.transaction(() => {
        db.exec(schema);
        db.pragma(`application_id=${APPLICATION_ID}`);
        db.pragma(`user_version=${SCHEMA_VERSION}`);
      })();
      db.pragma('journal_mode=WAL');
      this.db = db;
      return db;
    } catch (error) {
      db?.close();
      if (/personal studies|compatible app/.test(error.message)) throw error;
      throw new Error('Cannot open personal studies storage. Check disk permissions or restore a verified backup.', { cause: error });
    }
  }

  close() { this.db?.close(); this.db = null; }
}
