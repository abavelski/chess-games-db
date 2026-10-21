from pathlib import Path
import importlib.util
import struct
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('unpack', Path(__file__).resolve().parents[1] / 'unpack-cbv.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CbvValidationTest(unittest.TestCase):
    def archive(self, path, names):
        header = struct.pack('<HHB', 8, len(names), 149) + b'\0' * 3
        offset = 8 + 149 * len(names)
        records = []
        for name in names:
            records.append(name.ljust(128, b'\0') + struct.pack('<III', offset, 1, 1) + b'\0' * 9)
        path.write_bytes(header + b''.join(records) + b'x')

    def test_paths_duplicates_and_member_bounds_rejected_before_running_tool(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'fixture.cbv'
            for names in [[b'../escape.cbh'], [b'C:\\escape.cbh'], [b'/escape.cbh'], [b'a.cbh', b'A.cbh']]:
                self.archive(archive, names)
                with self.assertRaises(ValueError):
                    module.unpack('must-never-run', str(archive), str(Path(directory) / 'out'), 'windows-1251')
            archive.write_bytes(b'\x08')
            with self.assertRaisesRegex(ValueError, 'Truncated'):
                module.unpack('must-never-run', str(archive), directory, 'windows-1251')

    def test_valid_unicode_members_are_validated_then_copied_out_of_private_scratch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'fixture.cbv'
            filename = 'Книга.cbh'.encode('windows-1251')
            self.archive(archive, [filename])
            original = archive.read_bytes()
            def extract(command, **kwargs):
                staging = Path(next(value.split('=', 1)[1] for value in command if value.startswith('--output=')))
                (staging / filename.decode('windows-1252')).write_bytes(b'x')
            with patch.object(module.subprocess, 'run', side_effect=extract):
                output = module.unpack('fake-uncbv', str(archive), str(root / 'output'), 'windows-1251')
            self.assertEqual('Книга.cbh', output.name)
            self.assertEqual(b'x', output.read_bytes())
            self.assertEqual(original, archive.read_bytes())
