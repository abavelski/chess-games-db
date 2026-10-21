import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { pgnBlocks, extractToStage } from '../lib/import/extraction.mjs';
import { decodePgn } from '../lib/game-policy.mjs';
test('streamed UTF-8 blocks preserve BOM/CRLF/Unicode and header-looking comments',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'extract-'));
 try {
  const blocks=['\uFEFF[Event "Книга"]\r\n\r\n1. e4 {comment\r\n[White "fake"]\r\n} e5 *\r\n\r\n','[White "B"]\r\n\r\n1. d4 d5 *\r\n'];
  const path=join(dir,'games.pgn');writeFileSync(path,blocks.join(''));
  assert.deepEqual(await Array.fromAsync(pgnBlocks(path)),blocks);
  const stage=join(dir,'stage.db'),result=await extractToStage({path,format:'.pgn'},{},stage);
  assert.equal(result.summary.exported,2);
  const db=new Database(stage);assert.deepEqual(db.prepare('SELECT * FROM records ORDER BY sequence').all().map(decodePgn),blocks);db.close();
  writeFileSync(path,'[Event "x"]\n\n1. e4 {broken');
  await assert.rejects(extractToStage({path,format:'.pgn'},{},join(dir,'bad.db')),/Truncated/);
 }finally {rmSync(dir,{recursive:true,force:true});}
});
test('common policy keeps FEN starts, unknown players, null moves and parser failures while explaining empty records',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'policy-extract-'));
 try{
  const path=join(dir,'policy.pgn');writeFileSync(path,'[White "?"]\n[Black "?"]\n\n1. e4 e5 *\n[SetUp "1"]\n[FEN "8/8/8/8/8/4k3/8/4K3 w - - 0 1"]\n\n1. Kf1 *\n[Event "Malformed"]\n\n1. e4 e5 2. Bh6 *\n[Event "Null"]\n\n1. e4 -- 2. d4 *\n[Event "Empty"]\n\n*\n');
  const result=await extractToStage({path,format:'.pgn'},{},join(dir,'stage.db'));assert.equal(result.summary.scanned,5);assert.equal(result.summary.exported,4);assert.equal(result.summary.skipped,1);
  const db=new Database(result.stagePath);assert.equal(JSON.parse(db.prepare('SELECT data FROM diagnostics').get().data).reason,'empty-standalone-position');db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
