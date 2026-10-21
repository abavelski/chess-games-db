"""Run with: python tests/windows-release-data.test.py -v"""
from contextlib import contextmanager
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import os

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release_data', ROOT / 'scripts/windows-release-data.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


@contextmanager
def writable(path):
    db = sqlite3.connect(path)
    try:
        with db:
            yield db
    finally:
        db.close()


def database(path, ids=(1, 2), index=True):
    with writable(path) as db:
        db.executescript((ROOT / 'db/migrations/007_games.sql').read_text(encoding='utf-8'))
        db.executescript((ROOT / 'db/migrations/008_personal_analysis.sql').read_text(encoding='utf-8'))
        db.execute('PRAGMA user_version=7')
        db.execute('ALTER TABLE games ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0')
        for key, game_id in enumerate(ids):
            db.execute("INSERT INTO games(id,game_key,result_code,headers_json,pgn_zstd,pgn_sha256) "
                       "VALUES(?,?,'unknown','{}',?,?)", (game_id, 'game-' + str(key), b'pgn', str(key) * 64))
        if index:
            db.executescript((ROOT / 'db/migrations/009_position_index.sql').read_text(encoding='utf-8'))
            db.execute("INSERT INTO position_keys VALUES(1,42,'exact position',43,?)", ('0' * 16 + ':' + '0' * 16,))
            db.execute("INSERT INTO game_position_occurrences(game_id,position_id,path,ply,is_mainline) VALUES(?,1,'',0,1)", (ids[0],))


def query(path, sql):
    with writable(path) as db:
        return db.execute(sql).fetchall()


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='chess release ')
        self.root = Path(self.temp.name)
        self.local = self.root / 'local.sqlite3'
        self.source = self.root / 'source.sqlite3'
        self.incoming = self.root / 'incoming.sqlite3'
        database(self.local, index=False)
        database(self.source, ids=(101, 102, 103))
        with writable(self.local) as db:
            db.execute('UPDATE games SET favourite=1 WHERE id=2')
            db.execute("INSERT INTO game_personal_analysis VALUES(1,?, 'yesterday')", ('{"comments":["Æø chess"],"lines":[]}',))
        with writable(self.source) as db:
            db.execute('UPDATE games SET favourite=1')
            db.execute("INSERT INTO game_personal_analysis VALUES(102,'publisher notes','today')")
        release.snapshot(self.source, self.incoming)
        self.app = self.root / 'app'
        self.app.mkdir()
        (self.app / 'version').write_text('old')
        self.new = self.root / 'new-app'
        self.new.mkdir()
        (self.new / 'version').write_text('new')
        self.plan = self.root / 'plan.json'
        self.items = [dict(target=str(self.local), incoming=str(self.incoming), sha256=release.sha256(self.incoming))]
        self.write_plan()

    def tearDown(self):
        self.temp.cleanup()

    def write_plan(self):
        self.plan.write_text(json.dumps(self.items), encoding='utf-8')

    def install(self, check=False):
        release.apply(self.plan, self.app, self.new, check)

    def assert_originals(self):
        self.assertEqual((self.app / 'version').read_text(), 'old')
        self.assertEqual(query(self.local, 'SELECT id,favourite FROM games'), [(1, 0), (2, 1)])

    def test_snapshot_includes_indexes_but_excludes_publisher_study_state(self):
        self.assertEqual(query(self.incoming, 'SELECT favourite FROM games'), [(0,), (0,), (0,)])
        self.assertEqual(query(self.incoming, 'SELECT * FROM game_personal_analysis'), [])
        self.assertEqual(query(self.incoming, 'SELECT * FROM game_position_occurrences'),
                         query(self.source, 'SELECT * FROM game_position_occurrences'))
        self.assertEqual(query(self.source, 'SELECT count(*) FROM game_personal_analysis'), [(1,)])
        with self.assertRaises(FileExistsError):
            release.snapshot(self.source, self.incoming)

    def test_merge_matches_stable_keys_remaps_ids_and_preserves_exact_notes(self):
        expected = query(self.local, 'SELECT data_json,updated_at FROM game_personal_analysis')
        self.install()
        self.assertEqual(query(self.local, 'SELECT id,favourite FROM games'), [(101, 0), (102, 1), (103, 0)])
        self.assertEqual(query(self.local, 'SELECT data_json,updated_at FROM game_personal_analysis'), expected)
        self.assertEqual(query(self.local, 'SELECT game_id FROM game_personal_analysis'), [(101,)])
        self.assertEqual(query(self.local, 'SELECT * FROM game_position_occurrences'),
                         query(self.incoming, 'SELECT * FROM game_position_occurrences'))
        self.assertEqual((self.app / 'version').read_text(), 'new')
        self.assertEqual(len(list(self.root.glob('local.sqlite3.before-update-*'))), 1)

    def test_preflight_preserves_every_original(self):
        before = release.sha256(self.local)
        self.install(check=True)
        self.assert_originals()
        self.assertEqual(release.sha256(self.local), before)
        self.assertFalse(list(self.root.glob('*.before-update-*')))

    def test_changed_pgn_or_missing_game_stops_entire_update(self):
        for sql in ("UPDATE games SET pgn_sha256='a' || substr(pgn_sha256,2) WHERE id=1",
                    'DELETE FROM games WHERE id=2'):
            # Alter incoming so the target remains untouched on refusal.
            with writable(self.incoming) as db:
                db.execute(sql.replace('id=1', 'id=101').replace('id=2', 'id=102'))
            self.items[0]['sha256'] = release.sha256(self.incoming)
            self.write_plan()
            with self.assertRaisesRegex(RuntimeError, 'missing or PGN changed'):
                self.install()
            self.assert_originals()

    def test_bad_second_database_cannot_partially_install_first(self):
        self.items.append(dict(self.items[0], target=str(self.source), sha256='0' * 64))
        self.write_plan()
        with self.assertRaisesRegex(RuntimeError, 'checksum'):
            self.install()
        self.assert_originals()
        self.assertFalse(list(self.root.glob('*.before-update-*')))

    def test_wal_sidecar_refuses_update(self):
        Path(str(self.local) + '-wal').touch()
        with self.assertRaisesRegex(RuntimeError, 'Close all database'):
            self.install()
        self.assert_originals()

    @unittest.skipUnless(os.name == 'nt', 'Windows database handles')
    def test_open_database_handle_stops_commit(self):
        with writable(self.local) as reader:
            reader.execute('SELECT count(*) FROM games').fetchone()
            with self.assertRaisesRegex(RuntimeError, 'Cannot lock database'):
                self.install()
        self.assert_originals()

    def test_missing_index_object_refuses_publication(self):
        with writable(self.source) as db:
            db.execute('DROP VIEW searchable_game_position_occurrences')
        output = self.root / 'bad-snapshot.sqlite3'
        with self.assertRaisesRegex(RuntimeError, 'position-index object'):
            release.snapshot(self.source, output)
        self.assertFalse(output.exists())

    def test_rename_failure_rolls_back_database_and_app(self):
        real_replace = os.replace

        def fail_app(source, target):
            if Path(source) == self.new:
                raise PermissionError('simulated app locked')
            real_replace(source, target)

        with patch.object(release.os, 'replace', side_effect=fail_app):
            with self.assertRaisesRegex(PermissionError, 'simulated'):
                self.install()
        self.assert_originals()
        self.assertFalse((self.root / '.app-release-journal.json').exists())

    def test_crash_recovery_between_rename_and_journal_progress(self):
        backup = Path(str(self.local) + '.before-update-test')
        journal = self.root / '.app-release-journal.json'
        release.write_json(journal, dict(status='pending', entries=[dict(target=str(self.local), backup=str(backup))]))
        os.replace(self.local, backup)
        release.recover(journal)
        self.assert_originals()

    def test_snapshot_captures_committed_wal(self):
        with writable(self.source) as writer:
            writer.execute('PRAGMA journal_mode=WAL')
            writer.execute("UPDATE games SET white='WAL player' WHERE id=101")
            writer.commit()
            output = self.root / 'wal-snapshot.sqlite3'
            release.snapshot(self.source, output)
            self.assertEqual(query(output, 'SELECT white FROM games WHERE id=101'), [('WAL player',)])

    @unittest.skipUnless(os.name == 'nt', 'Windows PowerShell integration')
    def test_publish_and_update_two_databases_via_powershell(self):
        import shutil
        import sys
        scripts = self.root / 'scripts'
        scripts.mkdir()
        for name in ('publish-windows-update.ps1', 'update-windows-app.ps1', 'windows-release-data.py', 'Update.bat'):
            shutil.copyfile(ROOT / 'scripts' / name, scripts / name)
        (self.root / 'package.json').write_text('{"version":"test"}')
        package = self.root / 'release/win-unpacked'
        (package / 'resources').mkdir(parents=True)
        (package / 'Annotated Games Explorer.exe').write_text('new exe')
        (package / 'resources/app.asar').write_text('new asar')
        (self.app / 'resources').mkdir()
        (self.app / 'Annotated Games Explorer.exe').write_text('old exe')
        (self.app / 'resources/app.asar').write_text('old asar')
        second = self.root / 'second.sqlite3'
        local_second = self.root / 'local-second.sqlite3'
        database(second, ids=(201, 202, 203))
        database(local_second, index=False)
        share = self.root / 'share'

        def run(name, *args, success=True):
            result = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                                     str(scripts / name), *map(str, args)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
            return result

        # Use an invocation file to pass a true array under Windows PowerShell 5.1.
        invoke = scripts / 'publish-fixture.ps1'
        invoke.write_text("& (Join-Path $PSScriptRoot 'publish-windows-update.ps1') -SkipBuild "
                          "-ShareDirectory $args[0] -PythonPath $args[1] -DatabasePaths @($args[2],$args[3])")
        run('publish-fixture.ps1', share, sys.executable, self.source, second)
        config = self.root / 'database-updates.json'
        config.write_text(json.dumps({self.source.name: str(self.local), second.name: str(local_second)}))
        args = ('-InstallDirectory', self.app, '-ShareDirectory', share, '-PythonPath', sys.executable)
        # Native -File parameter binding is used for the receiving script.
        def update(*extra, success=True):
            result = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                                     str(share / 'Update-App.ps1'), *map(str, args), *extra], capture_output=True, text=True)
            self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
            return result
        update('-CheckOnly')
        self.assert_originals()
        update()
        self.assertEqual(query(self.local, 'SELECT id,favourite FROM games'), [(101, 0), (102, 1), (103, 0)])
        self.assertEqual(query(local_second, 'SELECT id FROM games'), [(201,), (202,), (203,)])
        self.assertEqual((self.app / 'Annotated Games Explorer.exe').read_text(), 'new exe')
        update()
        self.assertEqual(len(list(self.root.glob('app.before-update-*'))), 1)
        # App may be absent after a crash between its two renames. Recovery has
        # to precede InstallDirectory validation, including for app-only releases.
        backup = self.root / 'app.before-update-interrupted'
        journal = self.root / '.app-release-journal.json'
        release.write_json(journal, dict(status='pending', entries=[dict(target=str(self.app), backup=str(backup))]))
        os.replace(self.app, backup)
        update()
        self.assertTrue((self.app / 'Annotated Games Explorer.exe').exists())
        self.assertFalse(journal.exists())
        # A corrupt second shared DB must never install the first DB or app.
        run('publish-fixture.ps1', share, sys.executable, self.source, second)
        manifest = json.loads((share / 'latest.json').read_text())
        corrupt = share / manifest['databases'][1]['file']
        with corrupt.open('ab') as stream:
            stream.write(b'corrupt')
        original = release.sha256(self.local)
        update(success=False)
        self.assertEqual(release.sha256(self.local), original)
        self.assertEqual(len(list(self.root.glob('app.before-update-*'))), 1)


if __name__ == '__main__':
    unittest.main()
