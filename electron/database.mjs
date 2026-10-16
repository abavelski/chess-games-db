import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { decompress } from 'fzstd';
import { gameQuery, recordQuery } from './queries.mjs';
import { groupBooks, sequenceSql } from './books.mjs';
import { activeOpeningRevision, openingSelection, openingLabels, openingFacets } from './opening-read.mjs';

const LIMIT = 16 * 1024 * 1024;

function run(statement, method, params) {
  return Object.keys(params).length ? statement[method](params) : statement[method]();
}

function requiredId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid record ID.');
  return id;
}

export function decodePgn(row) {
  const compressed = row.pgn_zstd;
  if (!(compressed instanceof Uint8Array) || compressed.length > LIMIT) {
    throw new Error('PGN data is missing or exceeds the supported size.');
  }
  let bytes;
  try {
    bytes = decompress(compressed);
  } catch (cause) {
    throw new Error('Unable to decompress this Zstandard PGN: ' + String(cause));
  }
  if (bytes.length > LIMIT) throw new Error('Decompressed PGN exceeds the 16 MB safety limit.');
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== row.pgn_sha256) throw new Error('PGN SHA-256 check failed; the archive record may be damaged.');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function previewBytes(bytes) {
  if (!bytes) return null;
  const slice = bytes.subarray(0, 24000);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(slice);
    if (text.includes('\u0000')) return null;
    return text;
  } catch { return null; }
}

export class ChessArchive {
  constructor(path) {
    // Never create or migrate a user's archive in the desktop application.
    this.path = resolve(path);
    const db = new Database(this.path, { readonly: true, fileMustExist: true });
    try {
      db.pragma('foreign_keys = ON');
      const version = db.pragma('user_version', { simple: true });
      if (![3, 4].includes(version)) {
        throw new Error('This app supports database schema versions 3–4 (found ' + version + '). Run scripts/init-db.py on a backup to upgrade.');
      }
      for (const name of ['sources', 'games', 'source_records']) {
        if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)) {
          throw new Error('Required table is missing: ' + name);
        }
      }
      this.db = db;
      this.openingsSupported = version >= 4;
      const books = groupBooks(db.prepare('SELECT s.*, (SELECT count(*) FROM games g WHERE g.source_id = s.id) game_count FROM sources s ORDER BY s.title, s.id').all());
      this.books = books;
      const ranks = new Map();
      for (const book of books) for (const section of book.sections) ranks.set(section.id, ranks.size);
      db.function('book_section_rank', { deterministic: true }, id => ranks.get(id) ?? 0);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  close() { this.db.close(); }

  catalog() {
    const sources = this.db.prepare(
      'SELECT s.id, s.source_key, s.title, s.author, s.original_file, ' +
      '(SELECT count(*) FROM games g WHERE g.source_id = s.id) AS game_count, ' +
      '(SELECT count(*) FROM games g WHERE g.source_id = s.id AND g.is_training = 1) AS training_count, ' +
      '(SELECT count(*) FROM source_records r WHERE r.source_id = s.id) AS record_count ' +
      'FROM sources s ORDER BY s.title COLLATE NOCASE, s.id'
    ).all();
    const totals = this.db.prepare(
      'SELECT count(*) AS entries, ' +
      "sum(CASE WHEN record_kind = 'game' THEN 1 ELSE 0 END) AS games, " +
      "sum(CASE WHEN record_kind = 'position' THEN 1 ELSE 0 END) AS positions, " +
      "sum(CASE WHEN record_kind = 'text' THEN 1 ELSE 0 END) AS texts, " +
      'sum(CASE WHEN is_training = 1 THEN 1 ELSE 0 END) AS training ' +
      'FROM games'
    ).get();
    const books = groupBooks(sources);
    return {
      path: this.path,
      capabilities: { openings: this.openingsSupported },
      sources,
      books,
      totals: {
        entries: totals.entries,
        games: totals.games || 0,
        positions: totals.positions || 0,
        texts: totals.texts || 0,
        training: totals.training || 0,
        books: books.length,
      },
    };
  }

  searchGames(filters) {
    const revision = activeOpeningRevision(this.db, this.openingsSupported);
    const q = gameQuery(filters);
    const selection = openingSelection(this.db, revision, filters?.openingNodeId);
    if (selection.clause) {
      q.where += (q.where ? ' AND ' : ' WHERE ') + selection.clause;
      Object.assign(q.params, selection.params);
    }
    const from = ' FROM games g JOIN sources s ON s.id = g.source_id';
    const total = run(this.db.prepare('SELECT count(*) AS n' + from + q.where), 'get', q.params).n;
    const sql = 'SELECT g.id, g.source_id, g.source_game_key, g.white, g.black, ' +
      'g.event, g.site, g.date, g.year, g.result, g.eco, g.game_type, g.record_kind, ' +
      'g.is_training, g.training_magnitude, g.is_deleted, g.start_fen, g.annotator, ' +
      's.title AS source_title, s.author AS source_author' +
      from + q.where + ' ORDER BY ' + q.orderBy + ' LIMIT @limit OFFSET @offset';
    const rows = this.db.prepare(sql).all({ ...q.params, limit: q.pageSize, offset: q.offset });
    return { rows: openingLabels(this.db, revision, rows), total, page: q.page, pageSize: q.pageSize };
  }

  openingFacets(filters) {
    return openingFacets(this.db, this.openingsSupported, filters);
  }

  getGame(id) {
    const row = this.db.prepare(
      'SELECT g.*, s.title AS source_title, s.author AS source_author, ' +
      's.source_key FROM games g JOIN sources s ON s.id = g.source_id WHERE g.id = ?'
    ).get(requiredId(id));
    if (!row) return null;
    const pgn = decodePgn(row);
    const { pgn_zstd, ...metadata } = row;
    return openingLabels(this.db, activeOpeningRevision(this.db, this.openingsSupported), [{ ...metadata, pgn }])[0];
  }

  searchRecords(filters) {
    const q = recordQuery(filters);
    const from = ' FROM source_records r JOIN sources s ON s.id = r.source_id';
    const total = run(this.db.prepare('SELECT count(*) AS n' + from + q.where), 'get', q.params).n;
    const rows = this.db.prepare(
      'SELECT r.id, r.source_id, r.source_record_key, r.record_type, r.status, ' +
      'r.created_at, r.updated_at, length(r.raw_moves) AS raw_moves_size, ' +
      'length(r.raw_annotations) AS raw_annotations_size, s.title AS source_title' +
      from + q.where + ' ORDER BY ' + q.orderBy + ' LIMIT @limit OFFSET @offset'
    ).all({ ...q.params, limit: q.pageSize, offset: q.offset });
    return { rows, total, page: q.page, pageSize: q.pageSize };
  }

  bookContents(bookId) {
    const book = this.books.find(book => book.id === bookId);
    if (!book) throw new Error('Book not found in this archive.');
    const records = this.db.prepare(`
      SELECT r.id record_id, r.source_id, r.source_record_key record_key, r.status,
        g.id game_id, coalesce(g.record_kind, r.record_type) record_kind,
        coalesce(g.is_training, 0) is_training,
        coalesce(g.is_deleted, json_extract(r.metadata_json, '$.isDeleted'), 0) is_deleted,
        coalesce(json_extract(g.extras_json, '$.chapterText.titles[0].title'),
          json_extract(r.metadata_json, '$.chapterText.titles[0].title'),
          CASE WHEN g.white NOT IN ('', '?') OR g.black NOT IN ('', '?')
            THEN coalesce(g.white, '?') || ' vs ' || coalesce(g.black, '?') END,
          g.event, r.source_record_key) title,
        json_extract(r.metadata_json, '$.error') error,
        ${sequenceSql('r', 'metadata_json', 'source_record_key')} sequence
      FROM source_records r LEFT JOIN games g ON g.source_id = r.source_id AND g.source_game_key = r.source_record_key
      WHERE r.source_id = ?
      UNION ALL
      SELECT NULL, g.source_id, g.source_game_key, 'extracted', g.id, g.record_kind,
        g.is_training, g.is_deleted,
        coalesce(json_extract(g.extras_json, '$.chapterText.titles[0].title'), g.event, g.source_game_key), NULL,
        ${sequenceSql('g', 'extras_json', 'source_game_key')}
      FROM games g WHERE g.source_id = ? AND NOT EXISTS (
        SELECT 1 FROM source_records r WHERE r.source_id = g.source_id AND r.source_record_key = g.source_game_key)
      ORDER BY sequence, record_key
    `);
    return { ...book, entries: book.source_ids.flatMap(id => records.all(id, id)) };
  }

  getRecord(id) {
    const row = this.db.prepare(
      'SELECT r.*, s.title AS source_title FROM source_records r ' +
      'JOIN sources s ON s.id = r.source_id WHERE r.id = ?'
    ).get(requiredId(id));
    if (!row) return null;
    const { raw_moves, raw_annotations, ...metadata } = row;
    return {
      ...metadata,
      raw_moves_size: raw_moves?.length ?? 0,
      raw_annotations_size: raw_annotations?.length ?? 0,
      raw_preview: previewBytes(raw_moves),
    };
  }
}
