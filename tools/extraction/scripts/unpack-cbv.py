#!/usr/bin/env python3
"""Unpack a legacy CBV with uncbv, validate sizes, and restore filename encoding."""

import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path, PureWindowsPath


def unpack(executable, archive, destination, charset):
    data = Path(archive).read_bytes()
    if len(data) < 8:
        raise ValueError("Truncated CBV header")
    magic, count, record_size = struct.unpack_from("<HHB", data)
    if magic != 8 or record_size != 149:
        raise ValueError("Expected a legacy CBV archive with 149-byte directory records")
    if len(data) < 8 + count * record_size:
        raise ValueError("Truncated CBV directory")

    members = []
    for index in range(count):
        record = data[8 + index * record_size:8 + (index + 1) * record_size]
        name = record[:128].split(b"\0", 1)[0]
        offset, packed, size = struct.unpack_from("<III", record, 128)
        if offset < 8 + count * record_size or offset + packed > len(data):
            raise ValueError("Invalid CBV member bounds")
        original = PureWindowsPath(name.decode("windows-1252"))
        decoded = PureWindowsPath(name.decode(charset))
        if (not decoded.parts or decoded.drive or decoded.root
                or ".." in decoded.parts):
            raise ValueError("Invalid archive member path")
        members.append((Path(*original.parts), Path(*decoded.parts), size))

    databases = [decoded for _, decoded, _ in members if decoded.suffix.lower() == ".cbh"]
    if len(databases) != 1:
        raise ValueError("Expected exactly one .cbh database in the archive")

    # uncbv can report errors with exit code zero. Validate every member before
    # copying anything into the persistent database directory.
    with tempfile.TemporaryDirectory(prefix="yakov-cbv-") as temporary:
        staging = Path(temporary)
        subprocess.run([executable, "extract", archive, "--output=" + temporary,
                        "--no-confirm"], check=True, stdout=sys.stderr)
        for original, _, size in members:
            source = staging / original
            if not source.is_file() or source.stat().st_size != size:
                raise ValueError(f"Missing or incomplete archive member: {original}")
        destination = Path(destination).resolve()
        for original, decoded, _ in members:
            target = destination / decoded
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(staging / original, target)
    print(destination / databases[0])


if __name__ == "__main__":
    try:
        unpack(*sys.argv[1:])
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(f"CBV extraction failed: {error}")
