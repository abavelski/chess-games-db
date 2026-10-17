#!/usr/bin/env python3
"""Initialize the chess book schema without extracting or importing any games."""

import argparse
from pathlib import Path
import sqlite3


MIGRATIONS = Path(__file__).resolve().parents[1] / "db" / "migrations"
SCHEMA_VERSION = 7


def initialize(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=30, isolation_level=None)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        if connection.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
            raise RuntimeError("SQLite foreign key support is required")
        connection.execute("BEGIN IMMEDIATE")
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError(f"Database schema {version} is newer than supported {SCHEMA_VERSION}")
        if 0 < version < SCHEMA_VERSION:
            raise RuntimeError("Legacy database: use npm run migrate:games -- --input OLD --output NEW; initialization never converts existing archives")
        if version == 0 and connection.execute("SELECT 1 FROM sqlite_master WHERE type='table'").fetchone():
            raise RuntimeError("Refusing to initialize a nonempty unversioned database")
        for target in ([7] if version == 0 else []):
            # Execute complete statements individually: executescript() would
            # implicitly commit the transaction before running the migration.
            statement = ""
            migration = next(MIGRATIONS.glob(f"{target:03d}_*.sql"))
            for line in migration.read_text(encoding="utf-8").splitlines(True):
                statement += line
                if sqlite3.complete_statement(statement):
                    connection.execute(statement)
                    statement = ""
            if statement.strip():
                raise RuntimeError("Incomplete SQL migration")
            connection.execute(f"PRAGMA user_version = {target}")
        connection.execute("COMMIT")
    except BaseException:
        if connection.in_transaction:
            connection.execute("ROLLBACK")
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path, help="SQLite database file to create or initialize")
    args = parser.parse_args()
    try:
        initialize(args.database)
    except (OSError, sqlite3.Error, RuntimeError) as error:
        parser.exit(1, f"Database initialization failed: {error}\n")
    print(f"Database ready (schema {SCHEMA_VERSION}): {args.database}")
