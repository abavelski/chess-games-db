import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalStudiesStore, APPLICATION_ID, STANDARD_FEN } from '../lib/personal-studies/storage.mjs';

test('studies database is lazy, isolated, transactional and persistent', () => {
 const dir = mkdtempSync(join(tmpdir(),'studies-')), path = join(dir,'personal-studies.sqlite3');
 const store = new PersonalStudiesStore(path);
 try {
  assert.equal(existsSync(path),false);
  const db=store.open();
  assert.equal(db.pragma('application_id',{simple:true}),APPLICATION_ID);
  assert.equal(db.pragma('foreign_keys',{simple:true}),1);
  const insert=db.prepare('INSERT INTO studies(id,title,kind,root_fen,pgn,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
  insert.run('a','Title','other',STANDARD_FEN,'*','now','now');
  assert.throws(()=>db.transaction(()=>{insert.run('b','B','other',STANDARD_FEN,'*','now','now');throw Error('rollback');})());
  assert.equal(db.prepare('SELECT count(*) n FROM studies').get().n,1);
  assert.throws(()=>db.prepare('INSERT INTO study_tags VALUES(?,?,?)').run('missing','tag','Tag'),/FOREIGN KEY/);
  store.close();assert.equal(store.open().prepare('SELECT title FROM studies').get().title,'Title');
 } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('foreign, future and corrupt databases fail before modification',()=>{
 const dir=mkdtempSync(join(tmpdir(),'studies-invalid-'));
 try {
  for(const kind of ['foreign','future','corrupt']) {
   const path=join(dir,kind+'.db');
   if(kind==='corrupt')writeFileSync(path,'not sqlite');
   else {const db=new Database(path);db.pragma(`application_id=${kind==='foreign'?123:APPLICATION_ID}`);db.pragma('user_version=99');db.close();}
   const before=readFileSync(path),store=new PersonalStudiesStore(path);
   assert.throws(()=>store.open(),/studies|schema/);
   assert.deepEqual(readFileSync(path),before);
  }
 } finally {rmSync(dir,{recursive:true,force:true});}
});
