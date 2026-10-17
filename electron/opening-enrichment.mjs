import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { decodePgn } from '../lib/game-policy.mjs';
import { OPENING_ALGORITHM, digest, classifyOpening } from './openings.mjs';

export async function enrichOpenings(path, input, { dryRun = false, rebuild = false, maxGames = Infinity, batchSize = 100, signal, progress = () => {} } = {}) {
  const db = new Database(path, { readonly: dryRun, fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 30000');
    if (db.pragma('user_version', { simple: true }) !== 7) throw new Error('Schema 7 required. Use npm run migrate:games to convert a legacy archive.');
    const { catalogue, manifest, checksum } = input;
    const active = db.prepare('SELECT r.* FROM opening_state s JOIN opening_revisions r ON r.id=s.revision_id WHERE r.status=\'complete\'').get();
    const sameDataset = active?.content_sha256 === checksum && active?.algorithm_version === OPENING_ALGORITHM && active?.upstream_commit === manifest.commit;
    const total = db.prepare("SELECT count(*) n FROM games").get().n;
    const currentCount = sameDataset ? db.prepare("SELECT count(*) n FROM game_openings o JOIN games g ON g.id=o.game_id AND g.pgn_sha256=o.pgn_sha256 WHERE o.revision_id=?").get(active.id).n : 0;
    if (dryRun) return { dryRun: true, total, pending: rebuild ? total : total - currentCount, catalogueEntries: catalogue.entries.length };
    if (sameDataset && currentCount === total && !rebuild) return report(db, active.id, 0, true);
    let revision = !rebuild && db.prepare("SELECT * FROM opening_revisions WHERE content_sha256=? AND algorithm_version=? AND upstream_commit=? AND status='staging' ORDER BY created_at DESC LIMIT 1").get(checksum, OPENING_ALGORITHM, manifest.commit);
    if (!revision) {
      revision = { id: digest(checksum + OPENING_ALGORITHM).slice(0, 16) + '-' + randomUUID() };
      db.transaction(() => {
        db.prepare('INSERT INTO opening_revisions(id, upstream_commit, content_sha256, algorithm_version) VALUES (?,?,?,?)').run(revision.id, manifest.commit, checksum, OPENING_ALGORITHM);
        const nodeInsert = db.prepare('INSERT INTO opening_nodes VALUES (?,?,?,?,?)');
        for (const node of catalogue.nodes) nodeInsert.run(revision.id, node.id, node.label, JSON.stringify(node.path), node.parent_id);
        const entryInsert = db.prepare('INSERT INTO opening_entries VALUES (?,?,?,?,?,?,?,?)');
        for (const entry of catalogue.entries) entryInsert.run(revision.id, entry.id, entry.node_id, entry.eco, entry.name, entry.pgn, entry.uci, entry.position_key);
        if (sameDataset && !rebuild) {
          db.prepare(`INSERT INTO game_openings SELECT ?, o.game_id, o.pgn_sha256, o.status, o.primary_entry_id, o.matched_ply, o.diagnostic FROM game_openings o JOIN games g ON g.id=o.game_id AND g.pgn_sha256=o.pgn_sha256 WHERE o.revision_id=?`).run(revision.id, active.id);
          db.prepare('INSERT INTO game_opening_matches SELECT ?, m.game_id, m.entry_id, m.ply FROM game_opening_matches m JOIN game_openings o ON o.game_id=m.game_id AND o.revision_id=? WHERE m.revision_id=?').run(revision.id, revision.id, active.id);
        }
      })();
    }
    const pending = db.prepare(`SELECT g.* FROM games g WHERE NOT EXISTS (SELECT 1 FROM game_openings o WHERE o.revision_id=? AND o.game_id=g.id AND o.pgn_sha256=g.pgn_sha256) ORDER BY g.id LIMIT ?`);
    const remove = db.prepare('DELETE FROM game_openings WHERE revision_id=? AND game_id=?');
    const insert = db.prepare('INSERT INTO game_openings VALUES (?,?,?,?,?,?,?)');
    const matchInsert = db.prepare('INSERT INTO game_opening_matches VALUES (?,?,?,?)');
    let processed = 0;
    while (processed < maxGames && !signal?.aborted) {
      const batch = pending.all(revision.id, Math.min(batchSize, maxGames - processed));
      if (!batch.length) break;
      db.transaction(() => {
        for (const game of batch) {
          let result;
          try { result = classifyOpening(decodePgn(game), catalogue); }
          catch (error) { result = { status: 'invalid', primary_entry_id: null, matched_ply: null, diagnostic: String(error.message).slice(0, 1000), matches: [] }; }
          remove.run(revision.id, game.id);
          insert.run(revision.id, game.id, game.pgn_sha256, result.status, result.primary_entry_id, result.matched_ply, result.diagnostic);
          for (const match of result.matches) matchInsert.run(revision.id, game.id, match.entry_id, match.ply);
        }
      })();
      processed += batch.length; progress({ processed, total });
      await setImmediate();
    }
    let published = false;
    db.transaction(() => {
      if (signal?.aborted || pending.get(revision.id, 1)) return;
      db.prepare("DELETE FROM game_openings WHERE revision_id=? AND game_id NOT IN (SELECT id FROM games)").run(revision.id);
      db.prepare("UPDATE opening_revisions SET status='complete', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(revision.id);
      db.prepare('INSERT INTO opening_state VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET revision_id=excluded.revision_id').run(revision.id);
      published = true;
    })();
    return report(db, revision.id, processed, published);
  } finally { db.close(); }
}

function report(db, revision, processed, published) {
  const statuses = Object.fromEntries(db.prepare('SELECT status, count(*) n FROM game_openings WHERE revision_id=? GROUP BY status').all(revision).map(row => [row.status, row.n]));
  const ecoDifferences = db.prepare(`SELECT count(*) n FROM game_openings o JOIN games g ON g.id=o.game_id JOIN opening_entries e ON e.id=o.primary_entry_id AND e.revision_id=o.revision_id WHERE o.revision_id=? AND g.eco IS NOT NULL AND upper(g.eco)!=e.eco`).get(revision).n;
  return { revision, processed, published, statuses, ecoDifferences };
}
