import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import Database from 'better-sqlite3';
import { ChessArchive } from '../electron/database.mjs';

const temporary = mkdtempSync(join(tmpdir(), 'chess-reader-'));
app.setPath('userData', temporary);
const path = join(temporary, 'archive.sqlite3');
const db = new Database(path);
for (const migration of ['001_initial', '002_source_records', '003_record_classification']) db.exec(readFileSync(new URL(`../db/migrations/${migration}.sql`, import.meta.url), 'utf8'));
db.pragma('user_version = 3');
const source = db.prepare('INSERT INTO sources (source_key, title, original_file) VALUES (?, ?, ?)');
source.run('book:catalog:reader:db-001', 'Reader book', '/books/Reader book/10 Chapter.cbh');
source.run('book:catalog:reader:db-002', 'Reader book', '/books/Reader book/2 Chapter.cbh');
source.run('book:catalog:reader:db-003', 'Reader book', '/books/Reader book/Contents.cbh');
source.run('pgn-fixture', 'Z PGN book', '/books/Collection.pgn');
// Standard Zstandard frame with a single uncompressed block, independently decoded
// and checksum-verified by the application just like compressed archive content.
function frame(pgn) {
  const bytes = Buffer.from(pgn);
  const header = Buffer.alloc(12);
  Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xa0]).copy(header);
  header.writeUInt32LE(bytes.length, 5);
  header.writeUIntLE((bytes.length << 3) | 1, 9, 3);
  return Buffer.concat([header, bytes]);
}
function insert(sourceId, n, kind, title, text, options = {}) {
  const key = options.ordinal ? `ordinal:${String(n).padStart(6, '0')}` : `cb:record:${n}`;
  const chapterText = kind === 'text' ? { textFormat: options.html ? 3 : 1, titles: [{ language: 'ENGLISH', title }], contents: [{ language: 'ENGLISH', text }] } : undefined;
  const metadata = JSON.stringify({ ...(options.ordinal ? { ordinal: n } : { recordId: n }), chapterText });
  const pgn = kind === 'text' ? '[Event "Book text"]\n\n; Text backup\n*' : '[White "White"]\n[Black "Black"]\n\n{ Opening explanation. } 1. e4 e5 *';
  if (!options.failed) db.prepare('INSERT INTO games(source_id,source_game_key,white,black,event,record_kind,is_deleted,pgn_zstd,pgn_sha256,extras_json) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(sourceId, key, kind === 'text' ? '?' : 'White', kind === 'text' ? '?' : 'Black', title, kind, options.deleted ? 1 : 0, frame(pgn), createHash('sha256').update(pgn).digest('hex'), metadata);
  if (!options.orphan) db.prepare('INSERT INTO source_records(source_id,source_record_key,record_type,status,metadata_json) VALUES (?,?,?,?,?)')
    .run(sourceId, key, kind === 'text' ? 'text' : 'game', options.failed ? 'failed' : 'extracted', options.failed ? JSON.stringify({ recordId: n, error: 'Fixture decoding error' }) : metadata);
}
// Deliberately insert in the wrong order. Preserve a failure and a deleted entry.
insert(2, 10, 'game', 'Final example', '', { deleted: true });
insert(2, 2, 'game', 'Example', '');
insert(2, 1, 'text', 'Chapter two', 'Opening prose.\r\u0004\rStudy the following game.');
insert(2, 3, 'position', 'Unavailable position', '', { failed: true });
insert(1, 1, 'text', 'Chapter ten', '<h2>Legacy heading</h2><p>Readable <b>HTML prose</b>.</p><script>window.readerInjected = true</script><img src="https://invalid.example/no.png" onerror="window.readerInjected = true">', { html: true });
insert(3, 1, 'text', 'Contents', 'Introduction to the book.');
insert(1, 2, 'game', 'Legacy game without raw record', '', { orphan: true });
insert(4, 10, 'game', 'PGN tenth', '', { ordinal: true });
insert(4, 2, 'game', 'PGN second', '', { ordinal: true });
db.close();
const hash = () => createHash('sha256').update(readFileSync(path)).digest('hex');
const originalHash = hash();
writeFileSync(join(temporary, 'archive.json'), JSON.stringify({ path }));
const archive = new ChessArchive(path);
const book = archive.catalog().books[0];
assert.deepEqual(book.source_ids, [3, 2, 1]);
const contents = archive.bookContents(book.id);
assert.deepEqual(contents.entries.map(e => [e.source_id, e.sequence]), [[3, 1], [2, 1], [2, 2], [2, 3], [2, 10], [1, 1], [1, 2]]);
assert.equal(contents.entries[3].status, 'failed');
assert.equal(contents.entries[4].is_deleted, 1);
assert.equal(contents.entries[6].record_id, null);
assert.throws(() => archive.bookContents('missing'), /not found/);
assert.deepEqual(archive.searchGames({ sourceIds: book.source_ids, deleted: 'all' }).rows.map(g => [g.source_id, g.source_game_key]), [[3, 'cb:record:1'], [2, 'cb:record:1'], [2, 'cb:record:2'], [2, 'cb:record:10'], [1, 'cb:record:1'], [1, 'cb:record:2']]);
assert.deepEqual(archive.searchRecords({ sourceIds: book.source_ids }).rows.map(r => [r.source_id, r.source_record_key]), [[3, 'cb:record:1'], [2, 'cb:record:1'], [2, 'cb:record:2'], [2, 'cb:record:3'], [2, 'cb:record:10'], [1, 'cb:record:1']]);
assert.equal(archive.searchGames({ sourceIds: book.source_ids, sort: 'newest', deleted: 'all' }).rows[0].source_id, 1);
assert.deepEqual(archive.searchGames({ sourceId: 4 }).rows.map(g => g.source_game_key), ['ordinal:000002', 'ordinal:000010']);
assert.deepEqual(archive.bookContents('pgn-fixture').entries.map(e => e.sequence), [2, 10]);
archive.close();
const errors = [];
app.on('browser-window-created', (_event, window) => window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); }));
async function smoke() {
  const timeout = setTimeout(() => { console.error('Reader smoke timed out'); app.exit(1); }, 30000);
  let exitCode = 0;
  try {
    const created = once(app, 'browser-window-created');
    await import('../electron/main.mjs');
    const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async () => {
      window.waitForReader = async predicate => {
        const deadline = Date.now() + 5000;
        while (!predicate()) { if (Date.now() > deadline) throw new Error('Reader UI did not update: ' + predicate); await new Promise(resolve => setTimeout(resolve, 20)); }
      };
      await waitForReader(() => document.querySelector('[aria-label="Book"] option')?.textContent === 'All books');
      const select = document.querySelector('[aria-label="Book"]');
      const option = [...select.options].find(option => option.textContent === 'Reader book');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await waitForReader(() => document.querySelector('.book-open'));
      document.querySelector('.book-open').click();
      await waitForReader(() => document.querySelector('.book-prose')?.textContent.includes('Introduction to the book.'));
      if (document.querySelector('.book-navigation select').value !== '0') throw new Error('Must begin at contents');
      document.querySelector('[aria-label="Next book entry"]').click();
      await waitForReader(() => document.querySelector('.book-prose')?.textContent.includes('Opening prose.'));
      if (document.querySelector('.book-plain').textContent.includes('\\u0004')) throw new Error('Legacy control marker leaked');
      document.querySelector('[aria-label="Next book entry"]').click();
      await waitForReader(() => document.querySelector('.book-game-review cg-board'));
      if (!document.querySelector('.review-transcript').textContent.includes('Opening explanation.')) throw new Error('Missing commentary');
      document.querySelector('[aria-label="Next move"]').click();
      await waitForReader(() => document.querySelector('.review-move[aria-current="step"]')?.textContent.includes('e4'));
      document.querySelector('[aria-label="Next book entry"]').click();
      await waitForReader(() => document.querySelector('.book-prose')?.textContent.includes('Content unavailable'));
      if (!document.querySelector('.book-prose').textContent.includes('Fixture decoding error')) throw new Error('Missing extraction error');
      document.querySelector('[aria-label="Next book entry"]').click();
      await waitForReader(() => document.querySelector('.book-entry-heading .deleted'));
      document.querySelector('[aria-label="Next book entry"]').click();
      await waitForReader(() => document.querySelector('.book-html b')?.textContent === 'HTML prose');
      if (document.querySelector('.book-html script, .book-html img') || window.readerInjected) throw new Error('Unsafe HTML');
      document.querySelector('.book-reader-header button').click();
      await waitForReader(() => !document.querySelector('.book-reader'));
      document.querySelector('.book-open').click();
      await waitForReader(() => document.querySelector('.book-html b'));
      if (document.querySelector('.book-navigation select').value !== '5') throw new Error('Reading place not restored');
      document.querySelector('[aria-label="Next book entry"]').click();
      await waitForReader(() => document.querySelector('.book-game-review cg-board'));
      if (!document.querySelector('[aria-label="Next book entry"]').disabled) throw new Error('Final boundary not disabled');
    })()`);
    window.setSize(920, 650);
    await window.webContents.executeJavaScript(`(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      const board = document.querySelector('.book-game-review cg-board').getBoundingClientRect();
      const score = document.querySelector('.review-score').getBoundingClientRect();
      if (board.width < 200 || score.right > innerWidth + 1) throw new Error('Reader does not fit minimum window');
    })()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'PageUp' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'PageUp' });
    await window.webContents.executeJavaScript('waitForReader(() => document.querySelector(".book-html b"))');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await window.webContents.executeJavaScript('waitForReader(() => !document.querySelector(".book-reader"))');
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    assert.deepEqual(errors, []);
    assert.equal(hash(), originalHash, 'Book browsing must preserve the archive byte for byte');
    console.log('Book reader passed: numeric/section sorting, mixed prose and chess, failed/deleted/orphan records, inert HTML, resume, keyboard, minimum window, archive unchanged.');
  } catch (error) { console.error(error); exitCode = 1; }
  finally {
    clearTimeout(timeout);
    app.on('will-quit', () => { rmSync(temporary, { recursive: true, force: true }); app.exit(exitCode); });
    app.quit();
  }
}
void smoke();
