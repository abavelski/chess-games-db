import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { OpeningUserStore } from '../lib/opening-user-store.mjs';
import { OPENING_START_FEN } from '../src/opening-session.mjs';

test('opening settings survive reopen and independent single-file backup; invalid patches are atomic', () => {
  const folder = mkdtempSync(join(tmpdir(), 'opening-user-')), path = join(folder, 'user.sqlite3');
  let store;
  try {
    store = new OpeningUserStore(path);
    const session = { libraryUUID: 'library-a', revision: 'revision-a', corpus: 'synthetic', explorer: {
      route: { mode: 'prefix', rootFen: OPENING_START_FEN, moves: ['e2e4','c7c5'], filters: { roles: ['theory'] } },
      kind: 'games', page: 2, flipped: true, previous: null, articleView: 'reader', readerKeys: [{ key: 'stable-article', id: 1 }], articleNames: {}, scrolls: { 'stable-article': 180 },
    }, review: { key: 'stable-document', treeHash: 'a'.repeat(64), sourcePath: '0.1.0', flipped: true } };
    const expected = store.patch({ language: 'de', workspace: 'openings', session });
    for (const patch of [{ arbitrarySQL: 'drop' }, { language: 'invalid' }, { session: { ...session, explorer: { ...session.explorer, route: { ...session.explorer.route, moves: ['e2e5'] } } } }, { session: { ...session, review: { documentId: 77 } } }]) assert.throws(() => store.patch(patch));
    assert.deepEqual(store.read(), expected);
    store.close(); store = new OpeningUserStore(path); assert.deepEqual(store.read(), expected);
    assert.equal(existsSync(path + '-wal'), false);
    const backup = join(folder, 'backup.sqlite3'); copyFileSync(path, backup);
    const copied = new OpeningUserStore(backup); assert.deepEqual(copied.read(), expected); copied.close();
  } finally { store?.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('opening user store refuses another database without modifying its schema', () => {
  const folder = mkdtempSync(join(tmpdir(), 'opening-user-kind-')), path = join(folder, 'other.sqlite3');
  try {
    const db = new Database(path); db.exec('PRAGMA user_version=7; CREATE TABLE games(id INTEGER);'); db.close();
    assert.throws(() => new OpeningUserStore(path), /Unsupported opening user store/);
    const read = new Database(path, { readonly: true }); assert.equal(read.pragma('user_version', { simple: true }), 7); assert.equal(read.prepare("SELECT count(*) n FROM sqlite_master WHERE name='settings'").get().n, 0); read.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
