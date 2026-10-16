import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBooks } from '../electron/books.mjs';

const source = (id, source_key, title = 'Иващенко. Учебник шахматных комбинаций', original_file = null) => ({
  id, source_key, title, original_file, author: null, game_count: id,
});

test('catalog sections appear as one book with all IDs and counts, without changing sources', () => {
  const title = 'Иващенко. Учебник шахматных комбинаций';
  const sources = [
    source(1, 'book:catalog:ivashchenko:db-001', title, `/books/${title}/Позиции/Первая ступень.cbh`),
    source(2, 'book:catalog:ivashchenko:db-002', title, `/books/${title}/Содержание.cbh`),
  ];
  const before = structuredClone(sources);
  sources.forEach(Object.freeze);
  const books = groupBooks(sources);
  assert.equal(books.length, 1);
  assert.deepEqual(books[0].source_ids, [2, 1]);
  assert.equal(books[0].game_count, 3);
  assert.deepEqual(books[0].sections.map(s => s.label), ['Содержание', 'Позиции / Первая ступень']);
  assert.deepEqual(sources, before);
});

test('same titles from separate catalog identities and unknown imports remain separate', () => {
  const books = groupBooks([
    source(1, 'book:catalog:edition-a:db-001'),
    source(2, 'book:catalog:edition-b:db-001'),
    source(3, 'custom-a'), source(4, 'custom-b'),
  ]);
  assert.equal(books.length, 4);
  assert.deepEqual(books.flatMap(b => b.source_ids), [1, 2, 3, 4]);
});

test('section labels support Windows paths, Unicode normalization, and missing provenance', () => {
  const books = groupBooks([
    source(1, 'book:catalog:test:db-001', 'Й', 'C:\\books\\И\u0306\\Level 1.cbh'),
    source(2, 'book:catalog:test:db-002', 'Й'),
  ]);
  assert.deepEqual(books[0].sections.map(s => s.label), ['Level 1', 'book:catalog:test:db-002']);
  assert.deepEqual(groupBooks([]), []);
});

test('identical section names remain distinguishable', () => {
  const book = groupBooks([
    source(1, 'book:catalog:test:db-001', 'Book', '/a/Exercises.cbh'),
    source(2, 'book:catalog:test:db-002', 'Book', '/b/Exercises.cbh'),
  ])[0];
  assert.notEqual(book.sections[0].label, book.sections[1].label);
});


test('section reading order recognizes front matter, numbered paths and named stages', () => {
  const names = ['10 Chapter', '2 Chapter', 'Позиции / Восьмая ступень', 'Позиции / Вторая ступень', 'Содержание'];
  const book = groupBooks(names.map((name, i) => source(i + 1, `book:catalog:test:db-${i + 1}`, 'Book', `/Book/${name}.cbh`)))[0];
  assert.deepEqual(book.sections.map(s => s.label), ['Содержание', '2 Chapter', '10 Chapter', 'Позиции / Вторая ступень', 'Позиции / Восьмая ступень']);
});
