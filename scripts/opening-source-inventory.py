"""Read-only OT-02 inventory. Reports may contain source text: write under data/.

Uses the Python standard library; no Electron/native SQLite ABI is required.
Immutable access deliberately avoids creating SQLite journal/SHM files. A live
WAL is refused rather than omitted from the snapshot.
"""
import argparse
from collections import Counter
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import platform
import re
import sqlite3
import time


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def open_source(path):
    path = Path(path).resolve(strict=True)
    wal = Path(str(path) + '-wal')
    if wal.exists() and wal.stat().st_size:
        raise ValueError('Source has a nonempty WAL; provide a closed snapshot')
    db = sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA query_only=ON')
    if db.execute('PRAGMA user_version').fetchone()[0] != 1:
        db.close()
        raise ValueError('Expected source schema v1')
    required = {'source_records', 'games', 'articles', 'article_bodies', 'import_runs'}
    names = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not required <= names:
        db.close()
        raise ValueError('Wrong database format; expected archival source')
    return db


class BodyProbe(HTMLParser):
    """Inventory heuristic only, never a sanitizer or an availability authority."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden = 0
        self.stack = []
        self.anchor = 0
        self.text = []
        self.prose = []
        self.diagrams = 0
        self.links = 0

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        suppressed = tag in ('head', 'script', 'style', 'iframe', 'object', 'nav', 'aside') or bool(
            set(attributes.get('class', '').lower().split()) & {'navbar', 'sidebar'})
        if tag not in ('area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'):
            self.stack.append((tag, suppressed))
            self.hidden += int(suppressed)
        if tag == 'a':
            self.anchor += 1
            self.links += 1
        if tag == 'img' and dict(attrs).get('alt', '').lower().startswith('fen:'):
            self.diagrams += 1

    def handle_endtag(self, tag):
        # Recover an unmatched child close without leaking a recognized nav
        # container into prose. Unbalanced source remains a heuristic result.
        index = next((i for i in range(len(self.stack) - 1, -1, -1)
                      if self.stack[i][0] == tag), None)
        if index is not None:
            self.hidden -= sum(int(entry[1]) for entry in self.stack[index:])
            del self.stack[index:]
        if tag == 'a':
            self.anchor = max(0, self.anchor - 1)

    def handle_data(self, text):
        if not self.hidden:
            self.text.append(text)
            if not self.anchor:
                self.prose.append(text)

    def result(self):
        text = ' '.join(' '.join(self.text).split())
        prose = ' '.join(' '.join(self.prose).split())
        status = ('empty' if not text else 'prose_candidate'
                  if len(prose) >= 100 else 'navigation_or_short_body')
        return dict(classification=status, text_chars=len(text),
                    nonlink_chars=len(prose), links=self.links,
                    fen_diagrams=self.diagrams,
                    text_sha256=hashlib.sha256(text.encode()).hexdigest())


def inventory(source):
    source = Path(source).resolve(strict=True)
    started = time.monotonic()
    before = sha256(source)
    db = open_source(source)
    try:
        def rows(sql):
            return [dict(r) for r in db.execute(sql)]

        counts = {name: db.execute('SELECT count(*) FROM ' + table).fetchone()[0]
                  for name, table in dict(game='games', article='articles',
                      annotations='game_annotations', article_bodies='article_bodies',
                      article_links='article_links', source_databases='source_databases',
                      source_records='source_records').items()}
        counts['records_with_decode_errors'] = db.execute(
            "SELECT count(*) FROM source_records WHERE errors_json != '[]'").fetchone()[0]
        counts['records_with_diagnostics'] = db.execute(
            "SELECT count(*) FROM source_records WHERE diagnostics_json != '[]'").fetchone()[0]
        runs = rows('SELECT * FROM import_runs')
        summary = json.loads(runs[-1]['summary_json'] or '{}')
        reconciliation = {k: dict(expected=summary[k], actual=v)
                          for k, v in counts.items() if k in summary and summary[k] != v}
        relationships = {r['relation_type']: r['n'] for r in rows(
            'SELECT relation_type,count(*) n FROM article_game_relations GROUP BY 1')}
        resolutions = {r['resolution_status']: r['n'] for r in rows(
            'SELECT resolution_status,count(*) n FROM article_links GROUP BY 1')}
        for key, value in [('relationship_types', relationships), ('link_resolution', resolutions)]:
            if key in summary and summary[key] != value:
                reconciliation[key] = dict(expected=summary[key], actual=value)
        body_counts = Counter()
        languages = Counter()
        body_manifest = []
        for r in db.execute('''SELECT b.id,b.article_id,b.language,b.content,
                a.primary_title,d.relative_path FROM article_bodies b
                JOIN articles a ON a.id=b.article_id
                JOIN source_records s ON s.id=a.id
                JOIN source_databases d ON d.id=s.database_id ORDER BY b.id'''):
            probe = BodyProbe()
            probe.feed(r['content'])
            probe.close()
            result = probe.result()
            body_counts[result['classification']] += 1
            languages[(r['language'], result['classification'])] += 1
            body_manifest.append(dict(id=r['id'], article_id=r['article_id'],
                language=r['language'], source=r['relative_path'], title=r['primary_title'], **result))
        # Three per decade/layout era and language, selected deterministically.
        samples = []
        buckets = Counter()
        for body in body_manifest:
            years = re.findall(r'(?:19|20)\d{2}', body['source'])
            era = str(int(years[0]) // 10 * 10) if years else 'undated'
            key = (era, body['language'], body['classification'])
            if buckets[key] < 3:
                samples.append(dict(era=era, **body))
                buckets[key] += 1
        integrity = [r[0] for r in db.execute('PRAGMA integrity_check')]
        foreign_keys = rows('PRAGMA foreign_key_check')
        report = dict(version=1, source=str(source), source_sha256=before,
            bytes=source.stat().st_size, platform=platform.platform(),
            import_runs=runs, counts=counts, reconciliation=reconciliation,
            integrity=integrity, foreign_key_violations=foreign_keys,
            source_roles=rows('''SELECT d.role,s.record_type,count(*) n,
                sum(s.source_deleted) deleted FROM source_records s
                JOIN source_databases d ON d.id=s.database_id GROUP BY 1,2'''),
            decode_status=rows('SELECT decode_status,count(*) n FROM source_records GROUP BY 1'),
            annotation_decode_status=rows('SELECT annotations_decode_status,count(*) n FROM games GROUP BY 1'),
            annotation_types=rows('SELECT annotation_type,count(*) n FROM game_annotations GROUP BY 1'),
            annotation_languages=rows('SELECT language,count(*) n FROM game_annotations GROUP BY 1'),
            roots=rows('SELECT start_fen,count(*) n FROM games GROUP BY 1'),
            moves=rows('''SELECT sum(main_line_ply) mainline_plies,sum(all_lines_ply) all_plies,
                max(all_lines_ply) largest_tree,sum(moves_pgn IS NULL) missing_notation FROM games'''),
            decoder_errors=rows('''SELECT s.id,d.relative_path,s.source_record_id,s.errors_json,
                s.diagnostics_json FROM source_records s JOIN source_databases d ON d.id=s.database_id
                WHERE s.errors_json != '[]' ORDER BY s.id'''),
            diagnostic_records=rows('''SELECT id,database_id,source_record_id,diagnostics_json
                FROM source_records WHERE diagnostics_json != '[]' ORDER BY id'''),
            relationships=relationships, link_resolution=resolutions,
            body_classification=dict(body_counts),
            body_languages=[dict(language=k[0], classification=k[1], count=v)
                            for k, v in sorted(languages.items())],
            body_samples=samples, body_manifest=body_manifest,
            body_heuristic='Recognized nav/aside/navbar/SideBar and head/active content excluded. Non-link visible text >=100 characters is only a prose candidate; manually inspect samples before OT-06.',
            historical_audit='Earlier content-audit two-Theory snapshot is historical, not current coverage.')
    finally:
        db.close()
    after = sha256(source)
    if before != after:
        raise ValueError('Source changed during inventory; report is invalid')
    report['source_unchanged'] = True
    report['elapsed_seconds'] = round(time.monotonic() - started, 3)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    local_data = Path('data').resolve()
    if not output.is_relative_to(local_data):
        parser.error('Real-data reports must remain under ignored data/')
    if output.exists():
        parser.error('Refusing existing report; choose a new output')
    report = inventory(args.source)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
    print(json.dumps({k: report[k] for k in ('counts', 'reconciliation', 'integrity',
        'body_classification', 'source_unchanged', 'elapsed_seconds')}, indent=2))
    if report['reconciliation'] or report['integrity'] != ['ok'] or report['foreign_key_violations']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
