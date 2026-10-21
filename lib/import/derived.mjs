import { readFileSync } from 'node:fs';
import { decodePgn, searchKey } from '../game-policy.mjs';
import { buildPositions, positionBuildStatus } from '../position-builder.mjs';
import { readCatalogue } from '../../scripts/openings.mjs';
import { enrichOpenings } from '../../electron/opening-enrichment.mjs';
import { classifyOpening, OPENING_ALGORITHM } from '../../electron/openings.mjs';
import { assertGames } from '../game-writer.mjs';
export const OPENING_PIN='a6189a30dc273ccb21fc2536a9a2fefd5592a67a';
export async function localCatalogue(path) {
 const input=await readCatalogue(path);
 if(input.manifest.commit!==OPENING_PIN) throw new Error('Opening catalogue differs from pinned revision '+OPENING_PIN);
 return input;
}
export async function refreshDerived(db,path,{catalogue,positions,signal}={}) {
 assertGames(db);let openings={status:'unenriched',processed:0};
 const active=db.prepare("SELECT r.* FROM opening_state s JOIN opening_revisions r ON r.id=s.revision_id WHERE r.status='complete'").get();
 if(catalogue) {
  if(!active) openings=await enrichOpenings(path,catalogue,{signal});
  else {
   if(active.content_sha256!==catalogue.checksum || active.upstream_commit!==catalogue.manifest.commit || active.algorithm_version!==OPENING_ALGORITHM) throw new Error('Active opening catalogue differs; use the explicit openings enrichment command');
   let last=0,processed=0;
   for(;;) {
    if(signal?.aborted) throw new Error('Import cancelled');
    const batch=db.prepare('SELECT g.* FROM games g WHERE id>? AND NOT EXISTS(SELECT 1 FROM game_openings o WHERE o.game_id=g.id AND o.revision_id=? AND o.pgn_sha256=g.pgn_sha256) ORDER BY g.id LIMIT 50').all(last,active.id);
    if(!batch.length) break;
    db.transaction(()=>{for(const row of batch) {
     let result;try{result=classifyOpening(decodePgn(row),catalogue.catalogue);}catch(error){result={status:'invalid',primary_entry_id:null,matched_ply:null,diagnostic:error.message,matches:[]};}
     db.prepare('DELETE FROM game_openings WHERE revision_id=? AND game_id=?').run(active.id,row.id);
     db.prepare('INSERT INTO game_openings VALUES(?,?,?,?,?,?,?)').run(active.id,row.id,row.pgn_sha256,result.status,result.primary_entry_id,result.matched_ply,result.diagnostic);
     for(const m of result.matches) db.prepare('INSERT INTO game_opening_matches VALUES(?,?,?,?)').run(active.id,row.id,m.entry_id,m.ply);
    }})();processed+=batch.length;last=batch.at(-1).id;await new Promise(r=>setImmediate(r));
   }
   openings={status:'complete',revision:active.id,processed};
  }
 } else if(active) openings={status:'preserved-without-refresh',revision:active.id,coverage:db.prepare('SELECT count(*) n FROM game_openings o JOIN games g ON g.id=o.game_id AND g.pgn_sha256=o.pgn_sha256 WHERE revision_id=?').get(active.id).n};
 let positionWork=null;
 if(positions) {
  if(!['mainline','all','resume'].includes(positions)) throw new Error('Position scope must be mainline, all or resume');
  db.exec(readFileSync(new URL('../../db/migrations/009_position_index.sql',import.meta.url),'utf8'));
  const all=positions==='all' || (positions==='resume' && !!db.prepare("SELECT 1 FROM game_position_index_state WHERE scope='all' LIMIT 1").get());
  positionWork=await buildPositions(db,{includeVariations:all,shouldStop:()=>!!signal?.aborted});
 }
 return {openings,positionWork,positions:positionBuildStatus(db),features:db.prepare('SELECT status,count(*) n FROM game_features GROUP BY status').all()};
}
export function verifyArchive(db,{checksums=true}={}) {
 assertGames(db);
 if(db.pragma('integrity_check',{simple:true})!=='ok' || db.pragma('foreign_key_check').length) throw new Error('Archive integrity/foreign-key verification failed');
 const mismatch=db.prepare(`WITH expected AS (SELECT property_key,value_key,label,numeric_value,count(*) game_count FROM game_property_values GROUP BY property_key,value_key)
 SELECT * FROM (SELECT * FROM expected EXCEPT SELECT property_key,value_key,label,numeric_value,game_count FROM property_options)
 UNION ALL SELECT * FROM (SELECT property_key,value_key,label,numeric_value,game_count FROM property_options EXCEPT SELECT * FROM expected) LIMIT 1`).get();
 if(mismatch) throw new Error('Property cache differs from source relations');
 for(const row of db.prepare('SELECT label,search_key FROM property_options').iterate()) if(searchKey(row.label)!==row.search_key) throw new Error('Property search key mismatch');
 let verified=0;
 if(checksums) for(const row of db.prepare('SELECT pgn_zstd,pgn_sha256 FROM games').iterate()) {decodePgn(row);verified++;}
 if(db.prepare('SELECT 1 FROM game_features f JOIN games g ON g.id=f.game_id WHERE f.pgn_sha256!=g.pgn_sha256 LIMIT 1').get()) throw new Error('Stale game features');
 return {verifiedGames:verified,integrity:'ok',foreignKeys:'ok',propertyCache:'equivalent'};
}
