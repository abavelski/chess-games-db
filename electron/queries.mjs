// Parameterized, bounded SQLite queries. Dynamic SQL consists only of our own
// whitelisted column/sort fragments; user input is always bound as data.
const SORTS = Object.freeze({
  newest: 'g.id DESC',
  oldest: 'g.id ASC',
  year_desc: 'g.year DESC, g.id DESC',
  year_asc: 'g.year ASC, g.id DESC',
  white: 'g.white COLLATE NOCASE ASC, g.id DESC',
  source: 's.title COLLATE NOCASE ASC, g.id DESC',
});

const trim = (value, max = 150) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const boundedInt = (value, minimum, maximum) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= minimum && n <= maximum ? n : null;
};
const contains = (field, name) => "instr(lower(coalesce(" + field + ", '')), lower(@" + name + ")) > 0";

function sourceFilter(f, alias, where, params) {
  const sourceId = boundedInt(f.sourceId, 1, 2147483647);
  if (sourceId !== null) {
    where.push(alias + '.source_id = @sourceId');
    params.sourceId = sourceId;
  }
  if (Array.isArray(f.sourceIds)) {
    // Keep an empty/invalid selection empty rather than exposing all books.
    const ids = [...new Set(f.sourceIds.map(id => boundedInt(id, 1, 2147483647)).filter(id => id !== null))];
    if (ids.length > 1000) throw new Error('Too many book sections selected.');
    where.push(ids.length ? alias + '.source_id IN (' + ids.map((id, i) => {
      params['source' + i] = id;
      return '@source' + i;
    }).join(', ') + ')' : '0');
  }
}

export function gameQuery(input = {}) {
  const f = input && typeof input === 'object' ? input : {};
  const where = [];
  const params = {};

  sourceFilter(f, 'g', where, params);

  if (['game', 'position', 'line', 'text'].includes(f.kind)) {
    where.push('g.record_kind = @kind');
    params.kind = f.kind;
  }
  if (f.training === 'yes' || f.training === 'no') {
    where.push('g.is_training = @training');
    params.training = f.training === 'yes' ? 1 : 0;
  }
  if (f.deleted !== 'all') {
    where.push('g.is_deleted = @deleted');
    params.deleted = f.deleted === 'deleted' ? 1 : 0;
  }
  const start = boundedInt(f.yearFrom, 1, 9999);
  const end = boundedInt(f.yearTo, 1, 9999);
  if (start !== null) { where.push('g.year >= @yearFrom'); params.yearFrom = start; }
  if (end !== null) { where.push('g.year <= @yearTo'); params.yearTo = end; }

  for (const [field, column] of [
    ['white', 'g.white'], ['black', 'g.black'], ['event', 'g.event'],
    ['annotator', 'g.annotator'],
  ]) {
    const value = trim(f[field]);
    if (value) { where.push(contains(column, field)); params[field] = value; }
  }

  const eco = trim(f.eco, 12);
  if (eco) { where.push("upper(coalesce(g.eco, '')) LIKE @eco"); params.eco = eco.toUpperCase().replace(/[%_]/g, '') + '%'; }

  const result = trim(f.result, 30);
  if (result && result !== 'all') { where.push('g.result = @result'); params.result = result; }

  const search = trim(f.search, 200);
  if (search) {
    where.push('(' + [
      'g.white', 'g.black', 'g.event', 'g.site', 'g.annotator',
      'g.source_game_key', 's.title', 's.author',
    ].map(field => contains(field, 'search')).join(' OR ') + ')');
    params.search = search;
  }

  const page = boundedInt(f.page, 1, 100000) ?? 1;
  const pageSize = boundedInt(f.pageSize, 1, 100) ?? 40;
  const orderBy = SORTS[f.sort] ?? SORTS.newest;

  return {
    where: where.length ? ' WHERE ' + where.join(' AND ') : '',
    params,
    orderBy,
    page, pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function recordQuery(input = {}) {
  const f = input && typeof input === 'object' ? input : {};
  const where = [];
  const params = {};
  sourceFilter(f, 'r', where, params);
  if (['game', 'text'].includes(f.recordType)) {
    where.push('r.record_type = @recordType'); params.recordType = f.recordType;
  }
  if (['extracted', 'failed'].includes(f.status)) {
    where.push('r.status = @status'); params.status = f.status;
  }
  const search = trim(f.search, 200);
  if (search) {
    where.push('(' + [
      contains('r.source_record_key', 'search'),
      contains('r.metadata_json', 'search'),
      contains('s.title', 'search'),
    ].join(' OR ') + ')');
    params.search = search;
  }
  const page = boundedInt(f.page, 1, 100000) ?? 1;
  const pageSize = boundedInt(f.pageSize, 1, 100) ?? 40;
  return {
    where: where.length ? ' WHERE ' + where.join(' AND ') : '',
    params, page, pageSize, offset: (page - 1) * pageSize,
  };
}
