import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('inventory', Path(__file__).resolve().parents[1] / 'scripts/opening-source-inventory.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InventoryTests(unittest.TestCase):
    def test_body_classification_does_not_call_navigation_a_translation(self):
        probe = module.BodyProbe()
        probe.feed('<script>hidden prose ' * 10 + '</script>')
        self.assertEqual(probe.result()['classification'], 'empty')
        probe = module.BodyProbe()
        probe.feed('<nav><a href="anything">A long catalogue title</a></nav>')
        self.assertEqual(probe.result()['classification'], 'empty')
        probe = module.BodyProbe()
        probe.feed('<a href="anything">A long catalogue title</a>')
        self.assertEqual(probe.result()['classification'], 'navigation_or_short_body')
        probe = module.BodyProbe()
        probe.feed('<p>' + 'Original explanation of a chess plan. ' * 5 + '</p>')
        self.assertEqual(probe.result()['classification'], 'prose_candidate')

    def test_wrong_format_and_live_wal_are_rejected_without_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.sqlite'
            db = sqlite3.connect(path)
            db.execute('PRAGMA user_version=1')
            db.close()
            before = module.sha256(path)
            with self.assertRaisesRegex(ValueError, 'Wrong database format'):
                module.open_source(path)
            self.assertEqual(module.sha256(path), before)
            Path(str(path) + '-wal').write_bytes(b'not a closed snapshot')
            with self.assertRaisesRegex(ValueError, 'nonempty WAL'):
                module.open_source(path)
            self.assertEqual(module.sha256(path), before)


if __name__ == '__main__':
    unittest.main()
