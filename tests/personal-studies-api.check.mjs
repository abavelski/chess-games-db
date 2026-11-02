import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalStudiesStore } from '../lib/personal-studies/storage.mjs';
import { performance } from 'node:perf_hooks';

test('bounded CRUD, literal search, AND tags, metadata, conflicts and atomic validation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'study-api-')),store=new PersonalStudiesStore(join(dir,'studies.db'));
 try {
  const pgn=readFileSync(new URL('./fixtures/personal-studies/annotated.pgn',import.meta.url),'utf8');
  const a=store.create({title:'Round 3',kind:'tournament',pgn,tags:[' Endgame ','ENDGAME','time   trouble']});
  assert.deepEqual(a.tags,['Endgame','time trouble']);assert.equal(a.year,2026);assert.equal(a.white_elo,1850);assert.equal(a.pgn,pgn);
  const b=store.create({title:'Other',tags:['Endgame']});
  for(const search of ['Round','Alice','Bob','Local tournament'])assert.equal(store.list({search}).total,1);
  assert.equal(store.list({search:'%'}).total,0);
  assert.equal(store.list({tags:['endgame','TIME trouble'],year:2026,kind:'tournament'}).total,1);
  assert.equal(store.list({limit:1,sort:'title'}).rows[0].id,b.id);
  const c=store.duplicate(a.id);assert.notEqual(c.id,a.id);assert.equal(c.pgn,pgn);
  const draft={title:'Saved',pgn,tags:['New']};const updated=store.update(a.id,draft,1);assert.equal(updated.revision,2);
  assert.throws(()=>store.update(a.id,{...draft,title:'Stale'},1),/conflict/);
  assert.equal(store.get(a.id).title,'Saved');assert.deepEqual(store.get(a.id).tags,['New']);
  for(const invalid of [{...draft,title:' '},{...draft,pgn:'1. e4 e5 (1... c5 2. Bh6) *'},{...draft,pgn:'x'.repeat(2097153)},{...draft,tags:[' ']}])assert.throws(()=>store.update(a.id,invalid,2));
  assert.equal(store.get(a.id).revision,2);assert.equal(store.list().total,3);
  store.open().exec("CREATE TRIGGER injected_failure BEFORE UPDATE ON studies BEGIN SELECT RAISE(ABORT,'injected IO failure'); END");
  assert.throws(()=>store.update(a.id,{...draft,title:'Failed disk write'},2),/injected IO/);
  assert.equal(store.get(a.id).revision,2);assert.deepEqual(store.get(a.id).tags,['New']);store.open().exec('DROP TRIGGER injected_failure');
  for(const query of [{limit:101},{sort:'injection'},{offset:-1},{year:'2026'},{sql:'DROP'}])assert.throws(()=>store.list(query));
  assert.throws(()=>store.delete(a.id,1),/conflict/);store.delete(a.id,2);assert.equal(store.list().total,2);assert.deepEqual(store.get(b.id).tags,['Endgame']);
  assert.equal(store.open().prepare('SELECT count(*) n FROM study_tags WHERE study_id=?').get(a.id).n,0);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('indexed collection pages do not load PGN payloads and stay responsive',t=>{
 const dir=mkdtempSync(join(tmpdir(),'study-list-perf-')),store=new PersonalStudiesStore(join(dir,'studies.db'));
 try{
  for(let i=0;i<240;i++)store.create({title:'Study '+String(i).padStart(3,'0'),tags:['Collection']});
  const start=performance.now(),page=store.list({tags:['collection'],sort:'title',limit:100,offset:100}),elapsed=performance.now()-start;
  assert.equal(page.total,240);assert.equal(page.rows.length,100);assert.equal(page.rows[0].title,'Study 100');assert.equal(Object.hasOwn(page.rows[0],'pgn'),false);
  t.diagnostic(`100-row page from 240 studies: ${elapsed.toFixed(1)} ms`);assert.ok(elapsed<2000);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
