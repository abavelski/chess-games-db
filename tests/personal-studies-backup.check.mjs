import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalStudiesStore } from '../lib/personal-studies/storage.mjs';
test('online WAL backup restores complete saved collection, preserves target and remains standalone',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'study-backup-')),source=new PersonalStudiesStore(join(dir,'source.db')),target=new PersonalStudiesStore(join(dir,'restored.db'));
 try{
  source.open().pragma('wal_autocheckpoint=0');
  const a=source.create({title:'WAL study',pgn:'{Root} 1. e4 {[%cal Ge2e4]} e5 *',tags:['Tag']}),b=source.create({title:'Second'});
  const backup=join(dir,'backup.sqlite3');await source.backup(backup);
  const before=readFileSync(backup);await assert.rejects(()=>source.backup(backup),/already exists/);assert.deepEqual(readFileSync(backup),before);
  copyFileSync(backup,target.path);assert.equal(target.list().total,2);assert.deepEqual(target.get(a.id),source.get(a.id));assert.equal(target.get(b.id).title,'Second');
  source.update(a.id,{title:'After snapshot',pgn:a.pgn},1);assert.equal(target.get(a.id).title,'WAL study');
  target.close();assert.equal(target.get(a.id).title,'WAL study');
 }finally{source.close();target.close();rmSync(dir,{recursive:true,force:true});}
});
