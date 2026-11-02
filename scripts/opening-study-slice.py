"""Export deterministic, local-only OT-03 source fixtures; never cleaned PGN."""
import argparse
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('inventory', Path(__file__).with_name('opening-source-inventory.py'))
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    output = args.output.resolve()
    if not output.is_relative_to(Path('data').resolve()) or output.exists():
        parser.error('Choose a new output under ignored data/')
    before = inventory.sha256(source)
    db = inventory.open_source(source)
    try:
        ids = {r[0] for r in db.execute('SELECT id FROM games WHERE id % 173 = 0')}
        # All nonstandard/missing roots, largest trees, every annotation type,
        # metadata across ECOs, known errors and representative warnings.
        for sql in [
            'SELECT id FROM games ORDER BY all_lines_ply DESC LIMIT 20',
            'SELECT min(id) FROM games GROUP BY start_fen',
            'SELECT min(id) FROM games GROUP BY eco',
            'SELECT min(game_id) FROM game_annotations GROUP BY annotation_type',
            "SELECT id FROM source_records WHERE record_type='game' AND errors_json != '[]'",
            "SELECT id FROM source_records WHERE record_type='game' AND diagnostics_json != '[]' ORDER BY id LIMIT 20",
        ]:
            ids.update(r[0] for r in db.execute(sql) if r[0] is not None)
        records = []
        for record_id in sorted(ids):
            game = dict(db.execute('''SELECT g.id,g.start_fen,g.moves_pgn,g.main_line_ply,g.all_lines_ply,
                g.annotations_decode_status,s.source_record_id,s.decode_status,s.errors_json,
                s.diagnostics_json,d.relative_path,d.role FROM games g
                JOIN source_records s ON s.id=g.id JOIN source_databases d ON d.id=s.database_id
                WHERE g.id=?''', (record_id,)).fetchone())
            game['annotations'] = [dict(r) for r in db.execute('''SELECT sequence,move_index,
                annotation_type,language,text,payload_json FROM game_annotations
                WHERE game_id=? ORDER BY sequence''', (record_id,))]
            records.append(game)
    finally:
        db.close()
    if before != inventory.sha256(source):
        raise ValueError('Source changed while exporting slice')
    result = dict(version=1, source_sha256=before, source_bytes=source.stat().st_size,
        selection='id%173=0 plus ECOs, roots, largest trees, annotation types, errors and warnings',
        games=records)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, ensure_ascii=False)
    print(json.dumps(dict(records=len(records), source_unchanged=True, output=str(output))))


if __name__ == '__main__':
    main()
