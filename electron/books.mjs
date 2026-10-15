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
    const label = (titleIndex >= 0 ? parts.slice(titleIndex + 1).join(' / ') : parts.at(-1))
      ?.replace(/\.[^.]+$/, '') || source.source_key;
    book.sections.push({ id: source.id, label, source_key: source.source_key });
  }
  for (const book of books.values()) {
    const labels = new Map();
    for (const section of book.sections) labels.set(section.label, (labels.get(section.label) || 0) + 1);
    for (const section of book.sections) {
      if (labels.get(section.label) > 1) section.label += ' (' + section.source_key + ')';
    }
  }
  return [...books.values()];
}
