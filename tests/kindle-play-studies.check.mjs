import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalStudiesStore } from '../lib/personal-studies/storage.mjs';
import { validatePgn } from '../lib/personal-studies/validation.mjs';
import { KindlePlayGame } from '../electron/kindle-play-game.mjs';
import { createKindleStudyPersistence } from '../electron/kindle-play-studies.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'kindle-studies-'));
  const store = new PersonalStudiesStore(join(directory, 'studies.sqlite3'));
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const game = new KindlePlayGame({ persist: createKindleStudyPersistence(store) });
  return { store, game };
}

test('same study saved from ply zero through turns and resignation; restart preserves PGN', async t => {
  const { store, game } = fixture(t);
  const other = store.create({ title: 'Keep me' });
  const start = game.start(1500);
  const row = store.list().rows.find(row => row.id !== other.id);
  assert.equal(row.revision, 1); assert.equal(row.black_elo, 1500);
  assert.equal(row.origin_kind, 'kindle-play');
  assert.match(store.get(row.id).pgn, new RegExp(start.gameId));
  await game.move('e2e4', 0, () => 'e7e5');
  await game.move('g1f3', 2, () => 'b8c6');
  assert.equal(store.get(row.id).revision, 3);
  game.resign();
  assert.equal(store.get(row.id).revision, 4);
  assert.equal(store.get(row.id).result, '0-1');
  assert.match(store.get(row.id).pgn, /1\. e4 e5 2\. Nf3 Nc6 0-1/);
  validatePgn(store.get(row.id).pgn);
  store.close();
  assert.equal(store.list().total, 2); assert.equal(store.get(other.id).revision, 1);
  assert.equal(store.get(row.id).result, '0-1');
});

test('Black opening, failed search, conflict and deleted study are atomic', async t => {
  const { store, game } = fixture(t);
  await assert.rejects(game.start(1500, 'black', () => 'bad'), { code: 'ENGINE_UNAVAILABLE' });
  assert.equal(store.list().total, 0);
  const start = await game.start(1700, 'black', () => 'e2e4');
  const row = store.list().rows[0];
  assert.equal(row.white_elo, 1700); assert.match(store.get(row.id).pgn, /1\. e4 \*/);
  await assert.rejects(game.move('e7e5', 1, () => 'bad'), { code: 'ENGINE_UNAVAILABLE' });
  assert.equal(store.get(row.id).revision, 1); assert.deepEqual(game.snapshot(), start);
  store.update(row.id, { title: 'Human edited', pgn: '*' }, 1);
  await assert.rejects(game.move('e7e5', 1, () => 'g1f3'), { code: 'STUDY_CONFLICT' });
  assert.deepEqual(game.snapshot(), start); assert.equal(store.get(row.id).title, 'Human edited');
  assert.throws(() => game.resign(), { code: 'STUDY_CONFLICT' });
  store.delete(row.id, 2);
  await assert.rejects(game.move('e7e5', 1, () => 'g1f3'), { code: 'STUDY_CONFLICT' });
  assert.deepEqual(game.snapshot(), start); assert.equal(store.list().total, 0);
});

test('storage failures never publish start or a half turn', async t => {
  const { store } = fixture(t);
  const persist = createKindleStudyPersistence(store);
  const create = store.create;
  store.create = () => { throw Error('disk full: private-path'); };
  const game = new KindlePlayGame({ persist });
  assert.throws(() => game.start(1500), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(game.snapshot(), null);
  store.create = create; const start = game.start(1500);
  const update = store.update; store.update = () => { throw Error('disk full'); };
  await assert.rejects(game.move('e2e4', 0, () => 'e7e5'), { code: 'STORAGE_UNAVAILABLE' });
  assert.deepEqual(game.snapshot(), start); assert.equal(store.list().rows[0].revision, 1);
  store.update = update;
  await game.move('e2e4', 0, () => 'e7e5');
  assert.equal(store.list().rows[0].revision, 2);
});

test('mate and automatic draw store correct results and replayable PGN', async t => {
  const { store, game } = fixture(t);
  game.start(1500);
  await game.move('f2f3', 0, () => 'e7e5');
  await game.move('g2g4', 2, () => 'd8h4');
  let row = store.list().rows[0];
  assert.equal(row.result, '0-1'); validatePgn(store.get(row.id).pgn);
  game.start(1500);
  for (let i = 0; i < 8; i++) await game.move(i % 2 ? 'f3g1' : 'g1f3', i * 2, () => i % 2 ? 'f6g8' : 'g8f6');
  row = store.list().rows.find(row => row.result === '1/2-1/2');
  assert.ok(row); validatePgn(store.get(row.id).pgn);
});
