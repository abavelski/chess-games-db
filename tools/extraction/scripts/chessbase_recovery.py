"""Conservative fixes on disposable copies; never overwrite an input database."""
from pathlib import Path
import shutil
import struct


def stage_metadata_recovery(cbh, destination):
    cbh = Path(cbh).resolve()
    destination = Path(destination).resolve()
    if destination == cbh.parent or cbh.parent in destination.parents:
        raise ValueError('Recovery destination must be outside the source database directory')
    destination.mkdir(parents=True, exist_ok=True)
    # Morphy's CBJ upgrade uses the base name as a Java temporary-file prefix,
    # which must have at least three characters (e.g. the exercise DB "T").
    staged_stem = cbh.stem.ljust(3, '_')
    actions = []
    if staged_stem != cbh.stem:
        actions.append({'file': cbh.name, 'action': 'alias_short_stem_for_reader',
                        'temporary_stem': staged_stem, 'reason': 'Reader requires a three-character temporary-file prefix'})
    for source in cbh.parent.iterdir():
        if source.is_file() and source.stem == cbh.stem and source.suffix.lower() not in {'.cbv', '.rar', '.zip'}:
            shutil.copy2(source, destination / (staged_stem + source.suffix))
    staged = destination / (staged_stem + cbh.suffix)
    for extension in ('.cbg', '.cba'):
        path = staged.with_suffix(extension)
        if not path.exists():
            continue
        original = path.read_bytes()
        if len(original) < 26 or struct.unpack_from('>H', original)[0] != 26:
            continue
        _, size, wasted, size64, wasted64 = struct.unpack_from('>Hiiqq', original)
        # Use the 32-bit value only when physical file length independently confirms it.
        # A shorter/truncated payload, or contradictory physical size, is never fabricated.
        if len(original) != size or size == size64 and wasted == wasted64:
            continue
        corrected = bytearray(original)
        struct.pack_into('>qq', corrected, 10, size, wasted)
        assert corrected[26:] == original[26:]
        path.write_bytes(corrected)
        actions.append({'file': cbh.with_suffix(extension).name, 'action': 'synchronize_duplicate_blob_counters',
                        'physical_bytes': len(original), 'size32': size, 'old_size64': size64,
                        'wasted32': wasted, 'old_wasted64': wasted64,
                        'payload_unchanged': True})
    # The pinned iterator requires one optional extended header per core record.
    # Ask Morphy to preserve present headers and supply its documented empty defaults
    # for missing optional metadata, using the original core move/annotation offsets.
    cbj = staged.with_suffix('.cbj')
    core = staged.read_bytes()
    if len(core) >= 46 and struct.unpack_from('>H', core, 3)[0] == 46:
        next_id = struct.unpack_from('>i', core, 6)[0]
        core_count = next_id - 1
    else:
        core_count = -1
    if cbj.exists() and core_count >= 0:
        data = cbj.read_bytes()
        if len(data) >= 32:
            version, item_size, count = struct.unpack_from('<iii', data)
            if (1 <= version <= 11 and item_size > 0 and 0 <= count < core_count
                    and len(core) == next_id * 46 and len(data) == 32 + count * item_size):
                actions.append({'file': cbj.name, 'action': 'pad_missing_optional_cbj',
                                'present_records': count, 'core_records': core_count,
                                'missing_from_id': count + 1,
                                'reason': 'Preserve existing extended metadata; missing optional fields remain defaults/unknown'})
    flags = staged.with_suffix('.flags')
    if flags.exists():
        data = flags.read_bytes()
        if len(data) >= 12 and struct.unpack_from('>I', data)[0] == 0x0F010A09:
            # Version-10 top-game rankings are optional and never consulted by PGN conversion.
            # Keep the original file; omit only its copy rather than reinterpret an unknown layout.
            flags.unlink()
            actions.append({'file': flags.name, 'action': 'omit_unsupported_optional_top_game_flags',
                            'header_id': '0x0F010A09',
                            'reason': 'Top-game rankings are not PGN data; original flags retained in source'})
    return staged, actions
