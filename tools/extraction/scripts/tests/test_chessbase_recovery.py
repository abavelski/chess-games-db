from pathlib import Path
import struct
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from chessbase_recovery import stage_metadata_recovery


class MetadataRecoveryTest(unittest.TestCase):
    def test_one_letter_source_name_is_aliased_only_in_temporary_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'source'; source.mkdir()
            cbh = source / 'T.cbh'; cbh.write_bytes(b'core')
            cbh.with_suffix('.cbj').write_bytes(b'extended')
            staged, actions = stage_metadata_recovery(cbh, Path(temporary) / 'staging')
            self.assertEqual('T__.cbh', staged.name)
            self.assertEqual(b'core', cbh.read_bytes())
            self.assertEqual(b'extended', staged.with_suffix('.cbj').read_bytes())
            self.assertEqual('alias_short_stem_for_reader', actions[0]['action'])

    def test_duplicate_counters_repaired_without_changing_source_or_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'source'; source.mkdir()
            cbh = source / 'book.cbh'; cbh.touch()
            original = struct.pack('>Hiiqq', 26, 33, 2, 26, 0) + b'payload'
            cbh.with_suffix('.cba').write_bytes(original)
            staged, actions = stage_metadata_recovery(cbh, Path(temporary) / 'staging')
            corrected = staged.with_suffix('.cba').read_bytes()
            self.assertEqual(original, cbh.with_suffix('.cba').read_bytes())
            self.assertEqual(original[26:], corrected[26:])
            self.assertEqual((33, 2), struct.unpack_from('>qq', corrected, 10))
            self.assertTrue(actions[0]['payload_unchanged'])

    def test_physical_size_disagreement_is_not_repaired(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'source'; source.mkdir()
            cbh = source / 'book.cbh'; cbh.touch()
            data = struct.pack('>Hiiqq', 26, 100, 2, 26, 0) + b'truncated'
            cbh.with_suffix('.cbg').write_bytes(data)
            staged, actions = stage_metadata_recovery(cbh, Path(temporary) / 'staging')
            self.assertEqual([], actions)
            self.assertEqual(data, staged.with_suffix('.cbg').read_bytes())

    def test_empty_cbj_is_reconciled_with_validated_core_count(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'source'; source.mkdir()
            cbh = source / 'book.cbh'
            core = bytearray(46 * 3)
            struct.pack_into('>H', core, 3, 46)
            struct.pack_into('>i', core, 6, 3)
            cbh.write_bytes(core)
            data = struct.pack('<iii', 11, 120, 0) + bytes(20)
            cbh.with_suffix('.cbj').write_bytes(data)
            staged, actions = stage_metadata_recovery(cbh, Path(temporary) / 'staging')
            self.assertEqual(data, staged.with_suffix('.cbj').read_bytes())
            self.assertEqual(data, cbh.with_suffix('.cbj').read_bytes())
            self.assertEqual(0, actions[0]['present_records'])
            self.assertEqual(2, actions[0]['core_records'])

    def test_source_directory_rejected_as_destination(self):
        with tempfile.TemporaryDirectory() as temporary:
            cbh = Path(temporary) / 'book.cbh'; cbh.touch()
            with self.assertRaises(ValueError):
                stage_metadata_recovery(cbh, temporary)

    def test_nonempty_incomplete_cbj_preserves_present_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'source'; source.mkdir()
            cbh = source / 'book.cbh'
            core = bytearray(46 * 3)
            struct.pack_into('>H', core, 3, 46)
            struct.pack_into('>i', core, 6, 3)
            cbh.write_bytes(core)
            metadata = struct.pack('<iii', 8, 78, 1) + bytes(20) + bytes(range(78))
            cbh.with_suffix('.cbj').write_bytes(metadata)
            staged, actions = stage_metadata_recovery(cbh, Path(temporary) / 'staging')
            self.assertEqual(metadata, staged.with_suffix('.cbj').read_bytes())
            self.assertEqual(2, actions[0]['missing_from_id'])
            self.assertEqual(metadata, cbh.with_suffix('.cbj').read_bytes())

    def test_known_optional_flags_version_omitted_only_from_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'source'; source.mkdir()
            cbh = source / 'book.cbh'; cbh.touch()
            flags = struct.pack('>iii', 0x0F010A09, 16, 0) + bytes(64)
            cbh.with_suffix('.flags').write_bytes(flags)
            staged, actions = stage_metadata_recovery(cbh, Path(temporary) / 'staging')
            self.assertFalse(staged.with_suffix('.flags').exists())
            self.assertEqual(flags, cbh.with_suffix('.flags').read_bytes())
            self.assertEqual('omit_unsupported_optional_top_game_flags', actions[0]['action'])
