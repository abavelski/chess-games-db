import { extractMainlinePositions } from '../position-mainline.mjs';
import { reviewPgn } from '../../src/pgn.mjs';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { zstdCompressSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { hash, revision } from './discovery.mjs';
import { extractionRoot, preflight, extractionSourceHash } from './preflight.mjs';
import { decodePgn } from '../game-policy.mjs';

export const PROTOCOL = 1;
export function extractionProfile(options, format) {
 return { ...(format==='.pgn'?{}:{converterSourceSha256:extractionSourceHash()}),policy:'unified-import-1', protocol:PROTOCOL, converter:'archive-pgn-1', format:format==='.pgn'?'pgn':'chessbase', charset:options.charset ?? (format === '.pgn' ? 'utf-8':'windows-1251'), languages:options.languages ?? 'all' };
}
export function headers(pgn) {
 const h={}, tag=/\s*\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"\\])*)"\s*\]/y;
 let at=pgn.charCodeAt(0)===0xfeff?1:0;
 for (;;) { tag.lastIndex=at;const m=tag.exec(pgn);if (!m) break;h[m[1]]=m[2].replace(/\\(.)/g,'$1');at=tag.lastIndex; }
 return h;
}
// Preserve line endings and all separator bytes. Headers begin a new block only
// outside comments/variations after movetext; header-looking comment text is safe.
export async function* pgnBlocks(path, charset='utf-8', signal) {
 const decoder=new TextDecoder(charset,{fatal:true,ignoreBOM:true});
 let pending='', block='', brace=false, depth=0, movetext=false;
 function line(text) {
  const isHeader=!brace && depth===0 && /^[\s\uFEFF]*\[\w+\s+"/.test(text);
  let completed;
  if (isHeader && movetext) { completed=block;block='';movetext=false; }
  block+=text;
  if (Buffer.byteLength(block,'utf8')>16*1024*1024) throw new Error('PGN block exceeds 16 MiB');
  const movetextLine=isHeader?text.replace(/^[\s\uFEFF]*(?:\[\w+\s+"(?:\\.|[^"\\])*"\s*\][ \t]*)+/, ''):text;
  if (!/^\s*%/.test(movetextLine)) {
   for (const char of movetextLine) {
    if (brace) { if (char==='}') brace=false;continue; }
    if (char===';') break;
    if (char==='{') {brace=true;continue;}
    if (char==='(') depth++;
    if (char===')') depth--;
    if (!/\s/.test(char)) movetext=true;
   }
  }
  return completed;
 }
 for await (const chunk of createReadStream(path,{signal})) {
  pending+=decoder.decode(chunk,{stream:true});
  let end;
  while ((end=pending.indexOf('\n'))>=0) { const done=line(pending.slice(0,end+1));pending=pending.slice(end+1);if(done) yield done; }
  if (pending.length>16*1024*1024) throw new Error('PGN line exceeds 16 MiB');
 }
 pending+=decoder.decode();if(pending) {const done=line(pending);if(done) yield done;}
 if (brace || depth!==0) throw new Error('Truncated/unbalanced PGN stream');
 if (block.trim()) yield block;
}
async function* pgnRecords(entry, options, profile, signal) {
 let scanned=0,exported=0,skipped=0,subset=false;
 for await (const pgn of pgnBlocks(entry.path,profile.charset,signal)) {
  if(options.count && exported>=options.count) {subset=true;break;}
  scanned++;const h=headers(pgn);
  const year=/^\d{4}/.test(h.Date??'') ? Number(h.Date.slice(0,4)):0;
  // PGN annotation selection counts original comments and NAGs, before any transformation.
  let tokens=[];try{tokens=reviewPgn(pgn).tokens;}catch{/* Preserve parser failures with unknown feature coverage. */}
  const annotations=tokens.reduce((n,t)=>n+(t.type==='comment'?1:0)+(t.nags?.length??0),0);
  const mainline=extractMainlinePositions(pgn);
  const empty=mainline.status==='complete' && mainline.occurrences.length===1;
  const reason=empty?'empty-standalone-position':year<(options.minYear??0)?'minimum-year':annotations<(options.minAnnotations??0)?'minimum-annotations':null;
  const key='ordinal:'+String(scanned).padStart(6,'0');
  if(reason) {skipped++;yield {protocol:1,type:'skip',key,reason};continue;}
  const bytes=Buffer.from(pgn,'utf8');
  exported++;
  yield {protocol:1,type:'record',key,sequence:scanned,headers:h,pgn_sha256:hash(bytes),pgn_zstd_base64:zstdCompressSync(bytes).toString('base64')};
 }
 yield {protocol:1,type:'summary',scanned,exported,skipped,coverage:subset?'intentional-subset':'full'};
}
async function* cbRecords(entry, options, profile, signal) {
 const dependencies=preflight(entry.format);
 const args=[join(extractionRoot,'scripts/extract.py'),'--input',entry.path,'--classpath',dependencies.classpath,'--uncbv',dependencies.uncbv,'--charset',profile.charset,'--languages',profile.languages,'--count',String(options.count??0),'--min-year',String(options.minYear??0),'--min-annotations',String(options.minAnnotations??0)];
 const child=spawn(dependencies.python,args,{stdio:['ignore','pipe','pipe']});
 let diagnostic='';
 child.stderr.on('data',chunk=>{process.stderr.write(chunk);diagnostic=(diagnostic+chunk.toString('utf8')).slice(-65536);});
 const exit=new Promise(resolve=>{child.once('error',error=>resolve({error}));child.once('exit',(code,signal)=>resolve({code,signal}));});
 const abort=()=>child.kill('SIGTERM');signal?.addEventListener('abort',abort,{once:true});
 try {
  for await (const line of createInterface({input:child.stdout,crlfDelay:Infinity})) {
   if(signal?.aborted) throw new Error('Import cancelled');
   if(line.length>24*1024*1024) throw new Error('Extraction record too large');
   yield JSON.parse(line);
  }
  const result=await exit;
  if(result.error || result.code!==0 || signal?.aborted) throw result.error??new Error('ChessBase producer failed/cancelled'+(diagnostic?'\n'+diagnostic:''));
 } finally {
  signal?.removeEventListener('abort',abort);
  child.kill('SIGTERM'); await exit;
 }
}
export async function extractToStage(entry, options, stagePath, signal) {
 preflight(entry.format);
 const before=await revision(entry.path),profile=extractionProfile(options,entry.format);
 if(entry.format==='.pgn' && profile.languages!=='all') throw new Error('Language filtering is available for ChessBase tagged comments only');
 const stage=new Database(stagePath);
 try {
  stage.exec('CREATE TABLE records(key TEXT PRIMARY KEY,sequence INTEGER NOT NULL UNIQUE,pgn_sha256 TEXT NOT NULL,pgn_zstd BLOB NOT NULL,metadata TEXT NOT NULL); CREATE INDEX records_hash ON records(pgn_sha256); CREATE TABLE diagnostics(data TEXT NOT NULL)');
  let summary=null,records=0,skips=0;const recovery=[];
  const stream=entry.format==='.pgn'?pgnRecords(entry,options,profile,signal):cbRecords(entry,options,profile,signal);
  for await(const record of stream) {
   if(signal?.aborted) throw new Error('Import cancelled');
   if(summary || record.protocol!==PROTOCOL) throw new Error('Invalid extraction protocol/order');
   if(record.type==='record') {
    if(typeof record.key!=='string' || !record.key || !Number.isSafeInteger(record.sequence)) throw new Error('Invalid extraction identity');
    const compressed=Buffer.from(record.pgn_zstd_base64,'base64');
    decodePgn({pgn_zstd:compressed,pgn_sha256:record.pgn_sha256});
    const {pgn_zstd_base64,...metadata}=record;
    stage.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(record.key,record.sequence,record.pgn_sha256,compressed,JSON.stringify(metadata));records++;
   } else if(record.type==='skip') {stage.prepare('INSERT INTO diagnostics VALUES(?)').run(JSON.stringify(record));skips++;}
   else if(record.type==='recovery') recovery.push(...record.actions);
   else if(record.type==='summary') summary=record;
   else throw new Error('Unknown extraction event');
  }
  if(!summary || summary.exported!==records || summary.skipped!==skips || summary.scanned!==records+skips) throw new Error('Missing/inconsistent producer summary');
  const after=await revision(entry.path);
  if(before.sha256!==after.sha256) throw new Error('Source changed during extraction');
  return {stagePath,profile,revision:before,summary,recovery};
 } finally {stage.close();}
}
