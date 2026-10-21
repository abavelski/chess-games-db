"""SQLite snapshots and recoverable portable-app/database installation (stdlib only).

All receiving-PC database writers must be closed for the entire update.
No PGN replay, position extraction, or index rebuilding happens here.
"""
import argparse
from contextlib import closing, contextmanager, ExitStack
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import uuid


def connect(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=5)


def validate(db, indexed=False):
    if db.execute('PRAGMA user_version').fetchone()[0] != 7:
        raise RuntimeError('Expected a schema-v7 database')
    if db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
        raise RuntimeError('Database integrity check failed')
    if db.execute('PRAGMA foreign_key_check').fetchone():
        raise RuntimeError('Database has broken foreign keys')
    db.execute('SELECT game_key,pgn_sha256 FROM games LIMIT 1')
    if indexed:
        meta = db.execute('SELECT schema_version,hash_algorithm,pawn_algorithm '
                          'FROM position_index_meta WHERE singleton=1').fetchone()
        if meta != (1, 'polyglot-standard-v1', 'polyglot-pawns-v1'):
            raise RuntimeError('Missing or incompatible position index')
        # Coverage may legitimately be partial; copy it as built, without replay.
        for table in ('position_keys', 'game_position_index_state', 'game_position_occurrences'):
            db.execute(f'SELECT * FROM {table} LIMIT 1')
        objects = {
            'searchable_game_position_occurrences': 'view',
            'game_position_index_invalidate_pgn': 'trigger',
            'position_keys_pawn_lookup': 'index',
            'game_position_index_state_coverage': 'index',
            'game_position_occurrences_position': 'index',
            'game_position_occurrences_game': 'index',
        }
        for name, kind in objects.items():
            if db.execute('SELECT type FROM sqlite_master WHERE name=?', (name,)).fetchone() != (kind,):
                raise RuntimeError(f'Missing or incompatible position-index object: {name}')
        db.execute('SELECT id,zobrist_hash,exact_key,pawn_hash,pawn_signature FROM position_keys LIMIT 0')
        db.execute('SELECT game_id,pgn_sha256,algorithm_id,indexer_version,scope,status,diagnostic,'
                   'created_at,updated_at,completed_at FROM game_position_index_state LIMIT 0')
        db.execute('SELECT id,game_id,position_id,path,ply,is_mainline FROM game_position_occurrences LIMIT 0')
        unique = any(row[2] and [col[2] for col in db.execute('PRAGMA index_info("' + row[1].replace('"', '""') + '")')]
                     == ['zobrist_hash', 'exact_key'] for row in db.execute('PRAGMA index_list(position_keys)'))
        if not unique:
            raise RuntimeError('Missing unique position-key index')


def has_table(db, table, schema='main'):
    return bool(db.execute(f'SELECT 1 FROM {schema}.sqlite_master WHERE type=? AND name=?',
                           ('table', table)).fetchone())


def has_favourites(db, schema='main'):
    return any(row[1] == 'favourite' for row in db.execute(f'PRAGMA {schema}.table_info(games)'))


def snapshot(source, output):
    output = Path(output)
    # Exclusive creation prevents accidental replacement, including aliases.
    with output.open('xb'):
        pass
    try:
        with closing(connect(source)) as src, closing(sqlite3.connect(output)) as dst:
            src.backup(dst)
            dst.execute('PRAGMA journal_mode=DELETE')
            validate(dst, indexed=True)
            # Study state belongs to each receiving PC, never to the publisher.
            if has_favourites(dst):
                dst.execute('UPDATE games SET favourite=0 WHERE favourite<>0')
            if has_table(dst, 'game_personal_analysis'):
                dst.execute('DELETE FROM game_personal_analysis')
            dst.commit()
    except BaseException:
        output.unlink(missing_ok=True)
        raise


def quiet(path):
    for suffix in ('-wal', '-shm', '-journal'):
        if Path(str(path) + suffix).exists():
            raise RuntimeError(f'Close all database connections before updating: {path}{suffix}')


def stamp(path):
    info = Path(path).stat()
    return (info.st_size, info.st_mtime_ns)


@contextmanager
def prevent_database_writers(path):
    """Windows: deny reads/writes across the swap, while permitting renames.

    Also detects another process with the database still open. Release only
    after the entire app + database installation (or rollback) has finished.
    """
    if os.name != 'nt':
        yield
        return
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                  wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateFileW(str(path), 0x80000000, 4, None, 3, 0x80, None)
    if handle == wintypes.HANDLE(-1).value:
        raise RuntimeError(f'Cannot lock database. Close all apps/tools using it: {path} '
                           f'(Windows error {ctypes.get_last_error()})')
    try:
        yield
    finally:
        kernel.CloseHandle(handle)


def merge(incoming, local, output):
    quiet(local)
    with closing(connect(local)) as old:
        validate(old)
    # incoming is already a checked local copy; move it to a sibling of the target
    # before preparing so the final rename stays on the target's own volume.
    with closing(connect(incoming)) as src, closing(sqlite3.connect(output, uri=True)) as dst:
        src.backup(dst)
        dst.execute('PRAGMA journal_mode=DELETE')
        dst.execute('PRAGMA foreign_keys=ON')
        validate(dst, indexed=True)
        dst.execute('ATTACH DATABASE ? AS previous', (Path(local).resolve().as_uri() + '?mode=ro',))
        missing = dst.execute('SELECT o.game_key FROM previous.games o LEFT JOIN main.games n '
                              'ON n.game_key=o.game_key AND n.pgn_sha256=o.pgn_sha256 '
                              'WHERE n.id IS NULL LIMIT 1').fetchone()
        if missing:
            raise RuntimeError(f'Local game missing or PGN changed: {missing[0]}. '
                               'Update refused; reconcile this archive explicitly.')
        if not has_favourites(dst):
            dst.execute('ALTER TABLE games ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0 CHECK(favourite IN (0,1))')
            dst.execute('CREATE INDEX games_favourite_idx ON games(id) WHERE favourite=1')
        dst.execute('UPDATE games SET favourite=0 WHERE favourite<>0')
        if has_favourites(dst, 'previous'):
            dst.execute('UPDATE main.games SET favourite=1 WHERE game_key IN '
                        '(SELECT game_key FROM previous.games WHERE favourite=1)')
        dst.execute('CREATE TABLE IF NOT EXISTS game_personal_analysis ('
                    'game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,'
                    'data_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
        dst.execute('DELETE FROM main.game_personal_analysis')
        if has_table(dst, 'game_personal_analysis', 'previous'):
            dst.execute('INSERT INTO main.game_personal_analysis(game_id,data_json,updated_at) '
                        'SELECT n.id,p.data_json,p.updated_at FROM previous.game_personal_analysis p '
                        'JOIN previous.games o ON o.id=p.game_id JOIN main.games n ON n.game_key=o.game_key')
        dst.commit()
        validate(dst, indexed=True)


def write_json(path, value):
    temporary = Path(str(path) + '.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def recover(journal):
    journal = Path(journal)
    if not journal.exists():
        return
    state = json.loads(journal.read_text(encoding='utf-8'))
    if state['status'] != 'committed':
        for entry in reversed(state['entries']):
            target, backup = Path(entry['target']), Path(entry['backup'])
            if backup.parent != target.parent or not backup.name.startswith(target.name + '.before-update-'):
                raise RuntimeError('Invalid recovery backup path')
            if backup.exists():
                if target.exists():
                    # Keep failed replacements too; never delete a user's database.
                    os.replace(target, target.with_name(target.name + '.failed-update-' + uuid.uuid4().hex))
                os.replace(backup, target)
        print('Recovered the previous app and databases from an interrupted update.')
    journal.unlink()


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def apply(plan_path, app, replacement, check_only=False):
    app, replacement = Path(app).resolve(), Path(replacement).resolve()
    journal = app.parent / ('.' + app.name + '-release-journal.json')
    recover(journal)
    plan = json.loads(Path(plan_path).read_text(encoding='utf-8-sig'))
    entries, prepared, originals = [], [], []
    token = uuid.uuid4().hex
    try:
        targets = [Path(item['target']).resolve(strict=True) for item in plan]
        if len(set(targets)) != len(targets):
            raise RuntimeError('Each database needs a different target path')
        for item, target in zip(plan, targets):
            if os.name == 'nt':
                import ctypes
                if ctypes.windll.kernel32.GetDriveTypeW(str(target.anchor)) == 4:
                    raise RuntimeError('Receiving database must be on a local disk')
            if app == target or app in target.parents:
                raise RuntimeError('Databases must be outside the app directory')
            if target.is_symlink() or target.stat().st_nlink > 1:
                raise RuntimeError('Database aliases/hard links are not supported')
            incoming = Path(item['incoming']).resolve(strict=True)
            if sha256(incoming).lower() != item['sha256'].lower():
                raise RuntimeError('Database transfer checksum mismatch')
            before = stamp(target)
            staged = target.with_name('.' + target.name + '.update-' + token)
            with staged.open('xb'):
                pass
            prepared.append(staged)
            print(f'Checking and preserving local study work: {target}', flush=True)
            merge(incoming, target, staged)
            originals.append((target, before))
            entries.append(dict(target=str(target), staged=str(staged),
                                backup=str(target) + '.before-update-' + token))
        if check_only:
            print('Preflight passed. No installed app or database was replaced.')
            return
        entries.append(dict(target=str(app), staged=str(replacement),
                            backup=str(app) + '.before-update-' + token))
        # Persist the entire intent BEFORE the first rename. Next invocation can
        # roll back even after power loss between a rename and journal progress.
        with ExitStack() as locks:
            for target, before in originals:
                locks.enter_context(prevent_database_writers(target))
                quiet(target)
                if stamp(target) != before:
                    raise RuntimeError(f'Database changed during preparation: {target}')
            for staged in prepared:
                locks.enter_context(prevent_database_writers(staged))
            state = dict(status='pending', entries=entries)
            write_json(journal, state)
            try:
                for entry in entries:
                    os.replace(entry['target'], entry['backup'])
                    os.replace(entry['staged'], entry['target'])
                state['status'] = 'committed'
                write_json(journal, state)
            except BaseException:
                recover(journal)
                raise
        journal.unlink()
        for entry in entries:
            print('Previous version saved in: ' + entry['backup'])
    finally:
        for staged in prepared:
            staged.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    snap = sub.add_parser('snapshot')
    snap.add_argument('source')
    snap.add_argument('output')
    install = sub.add_parser('apply')
    install.add_argument('plan')
    install.add_argument('app')
    install.add_argument('replacement')
    install.add_argument('--check-only', action='store_true')
    recovery = sub.add_parser('recover')
    recovery.add_argument('journal')
    args = parser.parse_args()
    if args.command == 'snapshot':
        snapshot(args.source, args.output)
    elif args.command == 'recover':
        recover(args.journal)
    else:
        apply(args.plan, args.app, args.replacement, args.check_only)
