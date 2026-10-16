// A reading-order approximation for section filenames, never a source identity.
const natural = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
const stages = ['первая', 'вторая', 'третья', 'четвертая', 'пятая', 'шестая', 'седьмая', 'восьмая', 'девятая', 'десятая', 'одиннадцатая'];
function sectionKey(label) {
  return label.normalize('NFC').toLowerCase().replace(/ё/g, 'е')
    .replace(/\b(contents|introduction|preface)\b|содержание|введение|предисловие/g, '0 $&')
    .replace(new RegExp(stages.join('|'), 'g'), word => String(stages.indexOf(word) + 1));
}
export function compareSections(a, b) {
  const front = label => /^(содержание|contents|введение|introduction|предисловие|preface)(?:\b|\s|$)/iu.test(label.normalize('NFC')) ? 0 : 1;
  return Number(a.label === a.source_key) - Number(b.label === b.source_key) || front(a.label) - front(b.label) || natural.compare(sectionKey(a.label), sectionKey(b.label)) || natural.compare(a.source_key, b.source_key);
}
export function sequenceSql(alias, metadata, key) {
  // Numeric metadata is authoritative. Known stable-key conventions are fallbacks.
  return `coalesce(CASE WHEN json_type(${alias}.${metadata}, '$.recordId') = 'integer' THEN json_extract(${alias}.${metadata}, '$.recordId') END,
    CASE WHEN json_type(${alias}.${metadata}, '$.ordinal') = 'integer' THEN json_extract(${alias}.${metadata}, '$.ordinal') END,
    CASE WHEN ${alias}.${key} GLOB 'cb:record:[0-9]*' THEN CAST(substr(${alias}.${key}, 11) AS INTEGER)
         WHEN ${alias}.${key} GLOB 'ordinal:[0-9]*' THEN CAST(substr(${alias}.${key}, 9) AS INTEGER) END, ${alias}.id)`;
}
export function bookOrderSql(alias, metadata, key) {
  return `s.title COLLATE NOCASE ASC, book_section_rank(s.id) ASC, s.id ASC, ${sequenceSql(alias, metadata, key)} ASC, ${alias}.id ASC`;
}

// Presentation only: catalog imports may store each section as its own source.
// Group only explicit catalog book identities, never unrelated matching titles.
export function groupBooks(sources) {
  const books = new Map();
  for (const source of sources) {
    const match = /^(book:catalog:.+):db-\d+$/.exec(source.source_key);
    const id = match ? match[1] : source.source_key;
    let book = books.get(id);
    if (!book) {
      book = { id, title: source.title, author: source.author, source_ids: [], sections: [], game_count: 0 };
      books.set(id, book);
    }
    book.source_ids.push(source.id);
    book.game_count += source.game_count;
    const parts = (source.original_file || '').split(/[\\/]/);
    const titleIndex = parts.findLastIndex(part => part.normalize('NFC') === source.title.normalize('NFC'));
    const label = (titleIndex >= 0 ? parts.slice(titleIndex + 1).map(part => part.trim()).join(' / ') : parts.at(-1))
      ?.replace(/\.[^.]+$/, '') || source.source_key;
    book.sections.push({ id: source.id, label, source_key: source.source_key });
  }
  for (const book of books.values()) {
    book.sections.sort(compareSections);
    book.source_ids = book.sections.map(section => section.id);
    const labels = new Map();
    for (const section of book.sections) labels.set(section.label, (labels.get(section.label) || 0) + 1);
    for (const section of book.sections) {
      if (labels.get(section.label) > 1) section.label += ' (' + section.source_key + ')';
    }
  }
  return [...books.values()];
}
