import test from 'node:test';
import assert from 'node:assert/strict';
import { gameQuery, recordQuery } from '../electron/queries.mjs';

test('queries bind user input instead of injecting it into SQL', () => {
  const payload = "' OR 1=1 --";
  const q = gameQuery({ search: payload, white: payload, eco: 'A12' });
  assert.ok(!q.where.includes(payload));
  assert.equal(q.params.search, payload);
  assert.equal(q.params.white, payload);
  assert.equal(q.params.eco, 'A12%');
});

test('defaults hide deleted games and bound pagination', () => {
  const q = gameQuery({ page: -9, pageSize: 500, sort: 'DROP TABLE games' });
  assert.equal(q.page, 1);
  assert.equal(q.pageSize, 40);
  assert.match(q.orderBy, /book_section_rank/);
  assert.match(q.orderBy, /recordId/);
  assert.equal(q.params.deleted, 0);
  assert.equal(gameQuery({ deleted: 'all' }).params.deleted, undefined);
  assert.equal(gameQuery({ deleted: 'deleted' }).params.deleted, 1);
});

test('game filters support source, kind, years and training', () => {
  const q = gameQuery({
    sourceId: '3', kind: 'position', training: 'yes', yearFrom: '1980',
    yearTo: '2005', result: '1-0', sort: 'year_desc', page: 2,
  });
  assert.equal(q.params.sourceId, 3);
  assert.equal(q.params.kind, 'position');
  assert.equal(q.params.training, 1);
  assert.equal(q.params.yearFrom, 1980);
  assert.equal(q.params.yearTo, 2005);
  assert.equal(q.offset, 40);
  assert.match(q.orderBy, /^g.year DESC/);
});

test('source records can be searched by type and extraction status', () => {
  const q = recordQuery({ sourceId: 5, recordType: 'text', status: 'failed', search: 'error' });
  assert.equal(q.params.sourceId, 5);
  assert.equal(q.params.recordType, 'text');
  assert.equal(q.params.status, 'failed');
  assert.equal(q.params.search, 'error');
  assert.ok(q.where.includes('r.metadata_json'));
});

test('book filters bind every section for both games and original records', () => {
  for (const query of [gameQuery, recordQuery]) {
    const q = query({ sourceIds: [36, 37, 36, "1) OR 1=1 --"] });
    assert.match(q.where, /source_id IN \(@source0, @source1\)/);
    assert.equal(q.params.source0, 36);
    assert.equal(q.params.source1, 37);
    assert.ok(!q.where.includes('OR 1=1'));
    const section = query({ sourceIds: [36, 37], sourceId: 37 });
    assert.equal(section.params.sourceId, 37);
    assert.match(section.where, /source_id = @sourceId/);
    assert.match(query({ sourceIds: [] }).where, /\b0\b/);
    assert.throws(() => query({ sourceIds: Array.from({ length: 1001 }, (_, i) => i + 1) }), /Too many/);
  }
});
