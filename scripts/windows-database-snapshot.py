"""Validate a v7 archive and optionally create a consistent SQLite snapshot."""
import pathlib
import sqlite3
import sys

source = sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri() + "?mode=ro", uri=True)
try:
    version = source.execute("PRAGMA user_version").fetchone()[0]
    if version != 7:
        raise RuntimeError(f"Expected schema v7; got {version}")
    if len(sys.argv) == 3:
        output = pathlib.Path(sys.argv[2])
        if output.exists():
            raise RuntimeError("Refusing to overwrite an existing snapshot")
        with sqlite3.connect(output) as destination:
            source.backup(destination)
            if destination.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("Database snapshot failed integrity check")
    print("Database validated" + (" and snapshotted." if len(sys.argv) == 3 else "."))
finally:
    source.close()
