import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('opening migration is additive, transactional, constrained and repeatable', () => {
  const output = execFileSync('python3', ['-c', `
import importlib.util, tempfile, sqlite3
from pathlib import Path
spec=importlib.util.spec_from_file_location('init', 'scripts/init-db.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as folder:
 p=Path(folder)/'archive.db'; c=sqlite3.connect(p)
 for f in sorted(Path('db/migrations').glob('00[1-3]_*.sql')): c.executescript(f.read_text())
 c.execute('pragma user_version=3'); c.execute("insert into sources(source_key,title) values ('s','Book')")
 c.execute("insert into games(source_id,source_game_key,pgn_zstd,pgn_sha256) values (1,'g',X'010203',?)", ('a'*64,))
 c.commit(); before=c.execute('select * from games').fetchall(); c.close()
 try: m.initialize(p)
 except RuntimeError as error: assert 'migrate:games' in str(error)
 else: raise AssertionError('Legacy initialization must refuse')
 c=sqlite3.connect(p); c.executescript(Path('db/migrations/004_openings.sql').read_text()); c.execute('pragma user_version=4'); c.commit(); c.close()
 c=sqlite3.connect(p); c.execute('pragma foreign_keys=on')
 assert c.execute('pragma user_version').fetchone()[0]==4
 assert c.execute('select * from games').fetchall()==before
 c.execute("insert into opening_revisions(id,upstream_commit,content_sha256,algorithm_version) values ('r','commit','hash','v1')")
 c.execute("insert into opening_nodes values ('r','a','Family',?,null)", ('["Family"]',))
 c.execute("insert into opening_nodes values ('r','b','Line',?,'a')", ('["Family","Line"]',))
 for entry in ['one','two']:
  c.execute("insert into opening_entries values ('r',?,'b','A00','Name','1. a3','a2a3','same-position')",(entry,))
 c.execute("insert into game_openings values ('r',1,?,'matched','one',1,null)",('a'*64,))
 for query in ["insert into opening_state values (2,'r')", "insert into opening_state values (1,'missing')", "insert into game_openings values ('r',1,'hash','invalid','one',1,null)"]:
  try: c.execute(query)
  except sqlite3.IntegrityError: pass
  else: raise AssertionError(query)
 assert not c.execute('pragma foreign_key_check').fetchall()
 c.close()
 fresh=Path(folder)/'fresh.db'; m.initialize(fresh); m.initialize(fresh)
 assert sqlite3.connect(fresh).execute('pragma user_version').fetchone()[0]==7
 # Failed migrations roll back both schema and user_version.
 bad=Path(folder)/'bad'; bad.mkdir(); (bad/'005_bad.sql').write_text('CREATE TABLE temporary_table (id);\\nTHIS IS INVALID;\\n')
 m.MIGRATIONS=bad; m.SCHEMA_VERSION=7
 try: m.initialize(p)
 except RuntimeError: pass
 else: raise AssertionError('Must fail')
 c=sqlite3.connect(p)
 assert c.execute('pragma user_version').fetchone()[0]==4
 assert not c.execute("select name from sqlite_master where name='temporary_table'").fetchone()
 print('ok')
`], { encoding: 'utf8' });
  assert.match(output, /ok/);
});
