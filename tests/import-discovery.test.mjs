import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover, mandatory, revision, resolveSources } from '../lib/import/discovery.mjs';
test('read-only discovery, durable catalogue, rename evidence and ambiguous archive pairing', async () => {
 const root=mkdtempSync(join(tmpdir(),'import-discovery-'));
 try {
  const book=join(root,'Книга'); mkdirSync(book);
  for (const ext of mandatory) writeFileSync(join(book,'score'+ext), ext);
  writeFileSync(join(book,'score.cbv'),'archive'); writeFileSync(join(book,'bad.cbz'),'bad');
  let entries=discover({booksRoot:root});
  assert.equal(entries.find(e=>e.format==='.cbv').status,'alternative');
  assert.equal(entries.find(e=>e.format==='.cbz').status,'unsupported');
  const e=entries.find(e=>e.format==='.cbh'); e.revision=await revision(e.path);
  const original={version:1,books:[{number:5,folder:'Книга',databases:[{number:2,file:'score.cbh',source_key:'old:standalone'}]}]};
  const proposed=resolveSources(entries,original,{register:true});
  assert.equal(e.sourceKey,'old:standalone'); assert.equal(original.books[0].databases[0].revision,undefined);
  renameSync(book,join(root,'Renamed'));
  entries=discover({booksRoot:root});const renamed=entries.find(e=>e.format==='.cbh');renamed.revision=await revision(renamed.path);
  resolveSources(entries,proposed);assert.equal(renamed.sourceKey,'old:standalone');
  assert.throws(()=>resolveSources(entries,proposed,{sourceKey:'different'}),/Contradictory/);
 } finally { rmSync(root,{recursive:true,force:true}); }
});
test('ordinal drift and changed records require checksum-guarded reconciliation', async () => {
 const {reconcileRecord}=await import('../lib/import/discovery.mjs');
 const old=new Map([['ordinal:000001',{key:'ordinal:000001',pgn_sha256:'a'}],['ordinal:000002',{key:'ordinal:000002',pgn_sha256:'b'}]]);
 assert.match(reconcileRecord({key:'ordinal:000001',pgn_sha256:'b'},old.get('ordinal:000001'),old).conflict,/drift/);
 assert.equal(reconcileRecord({key:'ordinal:000001',pgn_sha256:'c'},old.get('ordinal:000001'),old,{key:'ordinal:000001',expectedSha256:'a'}).reconciled,true);
 assert.equal(reconcileRecord({},null,old,{key:'ordinal:000001',expectedSha256:'stale'}).conflict,'stale-reconciliation');
});
