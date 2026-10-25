import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { createTreeConverter } from '../lib/opening-tree-converter.mjs';
import { createArticleConverter } from '../lib/opening-article-converter.mjs';
import { BUILD_VERSIONS } from '../lib/opening-library-storage.mjs';
import { treeFixtures, articleFixtures } from './fixtures/opening-study.mjs';
import { digest } from '../lib/opening-source-tree.mjs';

test('article catalog, meaningful languages, exact evidence, ambiguous targets and untrusted hints remain distinct', () => {
  const db = new Database(':memory:'), input = new Database(':memory:');
  db.pragma('foreign_keys=ON'); input.pragma('foreign_keys=ON');
  try {
    db.exec(readFileSync(new URL('../db/opening-library-v1.sql', import.meta.url), 'utf8'));
    input.exec(readFileSync(new URL('../docs/opening-theory/book-library-schema.sql', import.meta.url), 'utf8'));
    db.exec("INSERT INTO source_collections VALUES(1,'synthetic:theory','Theory','theory','cbh','theory','{}')");
    input.exec(`INSERT INTO import_runs VALUES(1,'now','now','extracted','not_run','{}','{}');
      INSERT INTO source_databases(id,import_run_id,relative_path,absolute_path,file_name,format,role) VALUES(1,1,'Theory/Synthetic.cbh','unused','Synthetic.cbh','cbh','theory');`);
    for (const [id, kind] of [[1,'game'],[2,'game'],[3,'game'],[10,'article'],[11,'article']]) {
      db.prepare("INSERT INTO source_items VALUES(?,?,1,?,?,0,?,'decoded','pending')").run(id, `synthetic:${id}`, id, kind, digest(String(id)));
      db.prepare("INSERT INTO build_record_state(item_id,input_hash,converter_version,state) VALUES(?,?,?,'pending')").run(id, digest(String(id)), BUILD_VERSIONS.builder);
      input.prepare("INSERT INTO source_records(id,database_id,source_record_id,record_type,source_deleted,header_json,decode_status,decoder_metadata_json) VALUES(?,1,?,?,0,'{}','decoded','{}')").run(id, id, kind);
      if (kind === 'article') input.prepare("INSERT INTO articles(id,primary_title,header_json) VALUES(?,?,'{}')").run(id, id === 10 ? 'Synthetic plans' : 'Standalone essay');
      else input.prepare("INSERT INTO games(id,header_fields_json,annotations_decode_status,dto_metadata_json) VALUES(?,'{}','decoded_not_validated','{}')").run(id);
    }
    const treeConvert = createTreeConverter(db);
    for (const [i, f] of [treeFixtures[0], treeFixtures[4], treeFixtures[5]].entries())
      treeConvert(i + 1, { ...f, errors_json: '[]', annotations_decode_status: 'decoded_not_validated' }, f.annotations ?? []);
    const html = articleFixtures[0].versions[1].html + articleFixtures[1].html;
    input.prepare('INSERT INTO article_bodies(id,article_id,language,title,content) VALUES(100,10,?,?,?)')
      .run('ENGLISH', 'Synthetic plans', articleFixtures[0].versions[0].html);
    input.prepare('INSERT INTO article_bodies(id,article_id,language,title,content) VALUES(101,10,?,?,?)')
      .run('GERMAN', 'Ein Plan', html);
    input.prepare('INSERT INTO article_bodies(id,article_id,language,title,content) VALUES(102,11,?,?,?)')
      .run('ENGLISH', 'Standalone essay', articleFixtures[5].html);
    const anchors = [...html.matchAll(/<a /g)].map(m => m.index);
    const addLink = input.prepare(`INSERT INTO article_links(id,body_id,ordinal,line,column_no,raw_start_tag,href,arguments_json,target_record_id,position_hint,resolution_status)
      VALUES(?,101,?,1,?,'<a>','javascript:CBLink(...)','[]',?,?,?)`);
    addLink.run(1, 0, anchors[0], 1, '19', 'resolved_game');
    addLink.run(2, 1, anchors[1], null, null, 'ambiguous');
    addLink.run(3, 2, anchors[2], null, null, 'outside_extracted_scope');
    input.exec(`INSERT INTO article_link_candidates VALUES(2,2,'{}'); INSERT INTO article_link_candidates VALUES(2,3,'{}');
      INSERT INTO article_game_relations(article_id,game_id,relation_type,link_id,evidence_json) VALUES(10,1,'explicit_game_link',1,'{}');
      INSERT INTO article_game_relations(article_id,game_id,relation_type,link_id,evidence_json) VALUES(10,1,'explicit_game_link',1,'{}');
      INSERT INTO article_game_relations(article_id,game_id,relation_type,evidence_json) VALUES(10,1,'same_source_database','{}');`);
    const convert = createArticleConverter(db, input);
    convert(10); convert(11);
    const versions = db.prepare('SELECT language,source_language,meaningful FROM article_versions WHERE article_id=10 ORDER BY id').all();
    assert.deepEqual(versions, [{ language: 'en', source_language: 'ENGLISH', meaningful: 0 }, { language: 'de', source_language: 'GERMAN', meaningful: 1 }]);
    const targets = db.prepare('SELECT * FROM article_targets ORDER BY id').all();
    assert.deepEqual(targets.map(t => t.status), ['resolved','ambiguous','unavailable']);
    assert.equal(targets[0].document_id, 1); assert.equal(targets[0].raw_position_hint, '19');
    assert.equal(targets[0].node_id, null);
    assert.match(JSON.parse(targets[0].evidence_json).notice, /unvalidated/);
    assert.deepEqual(JSON.parse(targets[1].evidence_json).candidates.map(c => c.stableKey), ['synthetic:2','synthetic:3']);
    assert.equal(db.prepare('SELECT count(*) n FROM article_document_relations').get().n, 2);
    assert.equal(db.prepare('SELECT count(*) n FROM relation_evidence').get().n, 3);
    assert.equal(db.prepare("SELECT count(*) n FROM articles WHERE search_title LIKE '%standalone%'").get().n, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM article_document_relations WHERE article_id=11').get().n, 0);
    assert.equal(convert(10), false);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); input.close(); }
});
