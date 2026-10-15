# Chess Games DB

Project foundation for a small GUI to browse, filter, and search a local SQLite
chess archive, including games, setup positions, lines, and text records.
The GUI is planned; this repository currently provides the database schema,
initializer, and technical documentation.

## Layout

- `data/chess-books.sqlite3`: local database, excluded from Git along with the
  entire `data/` directory. A clone does not include this file.
- `db/migrations/`: ordered SQL migrations for schema version 3.
- `scripts/init-db.py`: transactional schema initializer and upgrader.
- [docs/database.md](docs/database.md): detailed tables, fields, constraints,
  relationships, indexes, and storage conventions.

The database has three tables: `sources` identifies source collections;
`games` holds searchable metadata and independently compressed PGN records;
`source_records` retains original record bytes and extraction metadata.
Each source can have many games and original records. Games are classified
as `game`, `position`, `line`, or `text`. Moves, variations, and annotations
are stored inside PGN rather than separate relational tables.

To create an empty database or upgrade a local copy, use Python 3 with SQLite
foreign-key and JSON support (SQLite 3.38+ includes JSON by default):

```sh
python3 scripts/init-db.py data/chess-books.sqlite3
```

Future GUI work can use indexed metadata for browsing and filtering. Displaying
move trees requires Zstandard decompression and a PGN parser; searching all board
positions or annotation text will require additional derived indexes.
