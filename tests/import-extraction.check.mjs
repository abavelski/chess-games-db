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
