import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { treeFixtures, articleFixtures } from './opening-study.mjs';

export function createOpeningSource(path) {
  const db = new Database(path);
  db.pragma('foreign_keys=ON');
  db.exec(readFileSync(new URL('../../docs/opening-theory/book-library-schema.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO import_runs VALUES(1,'now','now','extracted','not_run','{}','{}');
    INSERT INTO source_databases(id,import_run_id,relative_path,absolute_path,file_name,format,role,status)
      VALUES(1,1,'Main/Synthetic.2cbh','unused','Synthetic.2cbh','2cbh','main_games','extracted');
    INSERT INTO source_databases(id,import_run_id,relative_path,absolute_path,file_name,format,role,status)
      VALUES(2,1,'Theory/Synthetic.cbh','unused','Synthetic.cbh','cbh','theory','extracted');`);
  const record = db.prepare("INSERT INTO source_records(id,database_id,source_record_id,record_type,source_deleted,header_json,decode_status,decoder_metadata_json) VALUES(?,?,?, ?,0,'{}','decoded','{}')");
  for (const [i, f] of treeFixtures.entries()) {
    const id = i + 1;
    record.run(id, i % 2 + 1, id, 'game');
    db.prepare(`INSERT INTO games(id,white,black,eco,header_fields_json,start_fen,main_line_ply,all_lines_ply,moves_pgn,annotations_decode_status,dto_metadata_json)
      VALUES(?,?,?,'B20','{}',?,NULL,?,?,'decoded_not_validated','{}')`)
      .run(id, `Synthetic White ${id}`, 'Synthetic Black', f.start_fen, f.all_lines_ply ?? null, f.moves_pgn);
    for (const a of f.annotations ?? []) db.prepare(`INSERT INTO game_annotations(game_id,sequence,move_index,annotation_type,language,text,payload_json) VALUES(?,?,?,?,?,?,?)`)
      .run(id, a.sequence, a.move_index, a.annotation_type, a.language, a.text, a.payload_json);
  }
  db.prepare("UPDATE games SET event='Synthetic Open',played_date='2024.05.12',result='1-0',annotator='Synthetic Author' WHERE id=1").run();
  for (const id of [100,101,102]) {
    record.run(id, 2, id, 'article');
    db.prepare("INSERT INTO articles(id,primary_title,header_json) VALUES(?,?,'{}')").run(id, id === 100 ? 'Synthetic Sicilian plans' : id === 101 ? 'Standalone synthetic essay' : 'Unsafe synthetic source example');
  }
  const html = articleFixtures[0].versions[1].html + '<img alt="fen:broken"><img alt="fen:rnbqkbnr/pppppppp/8/8/8/7N/PPPPPPPP/RNBQKB1R b KQkq - 1 1"><p>Another position: 4k3/8/8/8/8/8/4P3/4K3 w - - 0 1</p>' + '<p>Original synthetic study paragraph. Complete development, protect the king, and compare the central pawn structures before choosing a plan.</p>'.repeat(30) + articleFixtures[1].html;
  db.prepare('INSERT INTO article_bodies(id,article_id,language,title,content) VALUES(1000,100,?,?,?)')
    .run('ENGLISH', 'Synthetic plans', articleFixtures[0].versions[0].html);
  db.prepare('INSERT INTO article_bodies(id,article_id,language,title,content) VALUES(1001,100,?,?,?)')
    .run('GERMAN', 'Ein Plan', html + '<p>by <a href="https://example.invalid/author">Synthetic Writer</a></p><p><a href="https://example.invalid/games">Games for the article</a></p><p><em><a href="https://example.invalid/shop">Related Products in the ChessBase Shop</a></em></p>');
  db.prepare('INSERT INTO article_bodies(id,article_id,language,title,content) VALUES(1002,101,?,?,?)')
    .run('ENGLISH', 'Standalone essay', articleFixtures[5].html);
  db.prepare('INSERT INTO article_bodies(id,article_id,language,title,content) VALUES(1003,102,?,?,?)')
    .run('ENGLISH', 'Unsafe synthetic source example', articleFixtures[2].html + '</a></svg>' + articleFixtures[3].html + '<p>Try this FEN: 4k3/8/8/8/8/8/4P3/4K3 w - - 0 1</p>');
  const anchors = [...html.matchAll(/<a /g)].map(m => m.index);
  for (const [i, column] of anchors.entries()) db.prepare(`INSERT INTO article_links(id,body_id,ordinal,line,column_no,raw_start_tag,href,arguments_json,target_record_id,position_hint,resolution_status)
    VALUES(?,1001,?,1,?,'<a>','javascript:CBLink(...)','[]',?,?,?)`)
    .run(i + 1, i, column, i === 0 ? 1 : null, i === 0 ? '19' : null, ['resolved_game','ambiguous','outside_extracted_scope'][i]);
  db.exec(`INSERT INTO article_link_candidates VALUES(2,5,'{}'); INSERT INTO article_link_candidates VALUES(2,6,'{}');
    INSERT INTO article_game_relations(article_id,game_id,relation_type,link_id,evidence_json) VALUES(100,1,'explicit_game_link',1,'{}');
    INSERT INTO article_game_relations(article_id,game_id,relation_type,evidence_json) VALUES(100,1,'same_source_database','{}');`);
  db.close();
}
