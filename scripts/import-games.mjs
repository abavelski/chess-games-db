import { markScratch, cleanAbandonedScratch } from '../lib/import/scratch.mjs';
import { applyInWorker } from '../lib/import/worker.mjs';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, openSync, closeSync, writeSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { initializeGames } from '../lib/game-writer.mjs';
import { discover, revision, loadRegistry, resolveSources } from '../lib/import/discovery.mjs';
import { inventoryArchive } from '../lib/import/inventory.mjs';
import { extractionProfile, extractToStage } from '../lib/import/extraction.mjs';
import { preflight } from '../lib/import/preflight.mjs';
import { prepareImportStorage, IMPORT_SCHEMA } from '../lib/import/storage.mjs';
import { planSource } from '../lib/import/planning.mjs';
import { applySource, assertImportCompatible, validateReplacement } from '../lib/import/apply.mjs';
import { localCatalogue, refreshDerived, verifyArchive } from '../lib/import/derived.mjs';
import { maintenanceLease } from '../lib/archive-access.mjs';
import { assertNew, assertUpdateTarget, onlineBackup, publishArchive, registryChecksum, publishRegistry } from '../lib/import/publication.mjs';

export const HELP=`Unified local game import (offline)
Usage: npm run import:games -- inspect|create|update OPTIONS

Sources (exactly one):
  --input PATH                 Individual .pgn, .cbh or legacy .cbv
  --books-root PATH            Discover books recursively
  --book FOLDER                Select one exact book folder
  --manifest PATH              Durable v1 catalogue (inspection never registers)
  --source-key KEY             Explicit edition identity for a single source
  --title TITLE                Override single-source title
  --reconcile PATH             Reviewed JSON: sources[locator], records[sourceKey],
                               aliases[sourceKey] (see docs/unified-import.md)

Destination (explicit):
  --output PATH                New archive for create; existing paths refused
  --target PATH                Existing v7 archive for update; close desktop first
  --archive PATH               Read-only schema/capability inventory for inspect
  --dry-run                    Stage and plan in scratch; no target/manifest writes

Extraction:
  --count N                    First N matching records; default: full scan
  --full-scan                  Explicit full scan (cannot combine with count)
  --min-year N                 Inclusive minimum year; default: 0
  --min-annotations N          Inclusive original annotation count; default: 0
  --languages ru,en|all         First available language per CB game; default: all
  --charset NAME               PGN default UTF-8; CB default windows-1251
  --accept-source-update       Acknowledge changed extraction profile

Derived data/reporting:
  --openings DIRECTORY         Checksummed pinned local catalogue; never downloads
  --unenriched                 Explicitly omit opening enrichment
  --positions mainline|all|resume  Opt-in position build/resume
  --report PATH                New JSON report; default: TARGET.import-RUNID.json
  --resume RUNID               Resume committed sources of a previous target run
  --help                       Show this help

Plain PGN needs npm dependencies only. Prepare CB tools explicitly:
  python3 tools/extraction/scripts/setup.py [--cbv]
New reports include backup path, source identities, profiles, revisions and counts.
Update uses a verified online backup; it never replaces the live target file.
`;
function options(args) {
 const strings=['input','books-root','book','manifest','source-key','title','output','target','archive','reconcile','count','min-year','min-annotations','languages','charset','openings','positions','report','resume'];
 const booleans=['help','dry-run','full-scan','accept-source-update','unenriched'];
 const {values:v,positionals}=parseArgs({args,allowPositionals:true,options:Object.fromEntries([...strings.map(k=>[k,{type:'string'}]),...booleans.map(k=>[k,{type:'boolean'}])])});
 if(v.help) return {help:true};
 const mode=positionals[0];if(positionals.length!==1 || !['inspect','create','update'].includes(mode)) throw new Error('Choose inspect, create or update; use --help');
 if(v.count && v['full-scan']) throw new Error('Use --count or --full-scan, not both');
 if(v.openings && v.unenriched) throw new Error('Use --openings or --unenriched, not both');
 for(const key of ['count','min-year','min-annotations']) if(v[key]!==undefined && (!/^\d+$/.test(v[key]) || !Number.isSafeInteger(Number(v[key])) || Number(v[key])<(key==='count'?1:0) || (key==='min-year' && Number(v[key])>9999))) throw new Error('Invalid --'+key);
 if(v.positions && !['mainline','all','resume'].includes(v.positions)) throw new Error('Invalid --positions scope');
 if(mode==='create' && (!v.output || v.target || v.resume)) throw new Error('Create requires --output, without --target/--resume');
 if(mode==='update' && (!v.target || v.output)) throw new Error('Update requires --target, without --output');
 if(mode==='inspect' && (v.target || v.output || v['dry-run'])) throw new Error('Inspect accepts --archive, without a destination');
 if(mode!=='inspect' && v.archive) throw new Error('--archive is for inspect only');
 if(v.book && !v['books-root']) throw new Error('--book requires --books-root');
 if(v['books-root'] && !v.manifest && mode!=='inspect') throw new Error('Book imports require an explicit --manifest');
 const result={mode,dryRun:!!v['dry-run'],count:v.count?Number(v.count):0,minYear:Number(v['min-year']??0),minAnnotations:Number(v['min-annotations']??0),languages:v.languages??'all',charset:v.charset,book:v.book,sourceKey:v['source-key'],title:v.title,acceptSourceUpdate:!!v['accept-source-update'],unenriched:v.unenriched,positions:v.positions,resume:v.resume};
 for(const k of ['input','manifest','output','target','archive','reconcile','openings','report']) if(v[k]) result[k]=resolve(v[k]);
 if(v['books-root']) result.booksRoot=resolve(v['books-root']);
 return result;
}
function committedRegistry(original,proposal,committed) {
 const result=structuredClone(original);
 for(const b of proposal.books) for(const d of b.databases) {
  if(!committed.has(d.source_key)) continue;
  let book=result.books.find(book=>book.number===b.number);
  if(!book){book={...b,databases:[]};result.books.push(book);}
  const index=book.databases.findIndex(old=>old.source_key===d.source_key);
  if(index<0) book.databases.push(d);else book.databases[index]=d;
 }
 return result;
}
function isAlias(a,b) {
 if(resolve(a)===resolve(b)) return true;
 try {const x=lstatSync(a),y=lstatSync(b);return x.dev===y.dev && x.ino===y.ino;}catch{return false;}
}
export async function importGames(o,{signal,failAfter}={}) {
 if(o.mode==='inspect' && o.archive) return {status:'inspected',archive:inventoryArchive(o.archive)};
 const runId=randomUUID(),started=new Date().toISOString();
 const entries=discover(o);let registry=loadRegistry(o.manifest);const manifestHash=o.manifest?registryChecksum(o.manifest):null;
 if(o.resume && o.target) {
  const previous=new Database(o.target,{readonly:true,fileMustExist:true});
  try {
   const saved=previous.prepare('SELECT registry_json FROM import_runs WHERE id=?').get(o.resume);
   if(!saved)throw new Error('Unknown durable resume run');
   if(saved.registry_json)registry=JSON.parse(saved.registry_json);
  } finally {previous.close();}
 }
 const mappings=o.reconcile?JSON.parse(readFileSync(o.reconcile,'utf8')):{};
 for(const e of entries.filter(e=>e.status==='candidate')) e.revision=await revision(e.path);
 let proposal=resolveSources(entries,registry,{sourceKey:o.sourceKey,mappings:mappings.sources,register:o.mode!=='inspect'});
 const candidates=entries.filter(e=>e.status==='candidate');
 if(o.title) {if(candidates.length!==1) throw new Error('--title requires exactly one source');candidates[0].title=o.title;}
 if(o.mode==='inspect') return {status:'inspected',entries,registryChanged:false};
 if(o.input && !o.sourceKey && !o.manifest)throw new Error('Individual inputs require --source-key or an explicit --manifest');
 if(!candidates.length) throw new Error('No supported candidate sources');
 if(candidates.some(e=>!e.sourceKey)) throw new Error('Every input requires --source-key or a manifest identity');
 for(const e of candidates) preflight(e.format);
 const destination=o.output??o.target;
 if(o.mode==='create') assertNew(destination);else assertUpdateTarget(destination);
 // Resolve dependencies before creating output directories or report files.
 let catalogue;
 if(!o.unenriched) {
  const path=o.openings??fileURLToPath(new URL('../data/openings-a6189a3/',import.meta.url));
  if(!existsSync(path)) throw new Error('No local opening catalogue; specify --openings or --unenriched');
  catalogue=await localCatalogue(path);
 }
 const reportPath=o.report??destination+'.import-'+runId+'.json',detailsPath=reportPath+'.records.jsonl';
 const protectedPaths=[destination,o.manifest,o.reconcile,...candidates.map(e=>e.path)].filter(Boolean);
 for(const path of [reportPath,detailsPath]) {
  assertNew(path);
  if(protectedPaths.some(p=>isAlias(path,p) || ['-wal','-shm','-journal'].some(s=>isAlias(path,p+s)))) throw new Error('Report aliases protected input/destination');
 }
 const report={protocol:1,runId,resumeFrom:o.resume??null,mode:o.mode,dryRun:!!o.dryRun,started,options:{...o},status:'failed',target:destination,report:reportPath,records:detailsPath,sources:[],discovery:entries.filter(e=>e.status!=='candidate'),tools:JSON.parse(readFileSync(new URL('../tools/extraction/pins.json',import.meta.url),'utf8'))};
 let scratch,db,planningDb,release,releaseManifest,detailsFd;
 const committed=new Set();
 try {
  mkdirSync(dirname(destination),{recursive:true});mkdirSync(dirname(reportPath),{recursive:true});
  const scratchParent=o.dryRun?tmpdir():dirname(destination);
  cleanAbandonedScratch(scratchParent);
  scratch=mkdtempSync(join(scratchParent,'.unified-import-'));markScratch(scratch);
  detailsFd=openSync(detailsPath,'wx');
  // Extraction stages every source before acquiring the target maintenance lease
  // or opening a write connection. A producer failure cannot modify the archive.
  const staged=[];
  for(const [i,e] of candidates.entries()) {
   if(signal?.aborted) throw new Error('Import cancelled');
   const sr={sourceKey:e.sourceKey,input:e.path,locator:e.locator,revision:e.revision,profile:extractionProfile(o,e.format),status:'extracting'};report.sources.push(sr);
   try {const extraction=await extractToStage(e,o,join(scratch,`source-${i}.db`),signal);Object.assign(sr,{summary:extraction.summary,recovery:extraction.recovery,status:'staged'});staged.push({e,extraction,sr});}
   catch(error){Object.assign(sr,{status:'failed',error:error.message});throw error;}
  }
  // Refresh proposals with the exact revisions verified by extraction.
  proposal=resolveSources(entries,registry,{sourceKey:o.sourceKey,mappings:mappings.sources,register:true});
  let livePath;
  if(o.mode==='update') {
   if(!o.dryRun) {release=maintenanceLease(destination);if(o.manifest)releaseManifest=maintenanceLease(o.manifest);}
   const source=new Database(destination,{readonly:true,fileMustExist:true});
   try {
    assertImportCompatible(source);
    if(o.dryRun) {livePath=join(scratch,'dry-run.db');await source.backup(livePath);}
    else {report.backup=await onlineBackup(source,destination+'.backup-'+runId+'.sqlite3');livePath=destination;}
   } finally {source.close();}
  } else {
   if(o.manifest && !o.dryRun)releaseManifest=maintenanceLease(o.manifest);
   livePath=join(scratch,'created.db');const fresh=new Database(livePath);initializeGames(fresh);fresh.close();
  }
  db=new Database(livePath);db.pragma('foreign_keys=ON');db.pragma('busy_timeout=0');
  assertImportCompatible(db);
  // Plan on a consistent scratch snapshot, including a lazily populated candidate
  // index. Dry-runs never install import tables or fingerprints in the target.
  const planPath=join(scratch,'planning.db');await db.backup(planPath);planningDb=new Database(planPath);prepareImportStorage(planningDb);
  if(o.resume && !planningDb.prepare('SELECT 1 FROM import_runs WHERE id=?').get(o.resume)) throw new Error('Unknown durable resume run');
  for(const {e,extraction,sr} of staged) {
   if(signal?.aborted) throw new Error('Import cancelled');
   if(o.resume) {
    const old=planningDb.prepare('SELECT * FROM import_sources WHERE source_key=? AND run_id=?').get(e.sourceKey,o.resume);
    if(old && old.revision_json===JSON.stringify(extraction.revision) && old.profile_json===JSON.stringify(extraction.profile)) {sr.status='resumed-complete';committed.add(e.sourceKey);continue;}
   }
   const stage=new Database(extraction.stagePath);
   try {
    sr.counts=planSource(planningDb,stage,e,extraction,{acceptSourceUpdate:o.acceptSourceUpdate,reconciliation:mappings.records?.[e.sourceKey],aliases:mappings.aliases?.[e.sourceKey],validateReplacement});
    for(const row of stage.prepare('SELECT p.*,r.pgn_sha256 FROM plan p JOIN records r USING(key) ORDER BY r.sequence').iterate()) writeSync(detailsFd,JSON.stringify({sourceKey:e.sourceKey,...row,candidates:JSON.parse(row.candidates)})+'\n');
    if(sr.counts.conflict) {sr.status='conflict';continue;}
    if(o.dryRun) {applySource(planningDb,stage,e,extraction,{runId});sr.status='planned';continue;}
    if((await revision(e.path)).sha256!==extraction.revision.sha256) throw new Error('Source changed after staging: '+e.path);
    // Install/backfill only after the verified backup and full extraction.
    const nextCommitted=new Set([...committed,e.sourceKey]);
    const nextRegistry=committedRegistry(registry,proposal,nextCommitted);
    sr.applied=(await applyInWorker(livePath,extraction.stagePath,e,extraction,{runId,failAfter,registryJson:JSON.stringify(nextRegistry)},signal)).applied;
    sr.status='committed';committed.add(e.sourceKey);
    // Keep planning's identity/candidate indexes current for later sources.
    planningDb.close();planningDb=null;rmSync(planPath);
    await db.backup(planPath);planningDb=new Database(planPath);
   } catch(error){sr.status='failed';sr.error=error.message;report.sourcesError=true;}
   finally {stage.close();}
  }
  const failed=report.sources.some(s=>['conflict','failed'].includes(s.status));
  if(!o.dryRun) {
   report.derived=await refreshDerived(db,livePath,{catalogue,positions:o.positions,signal});
   if(signal?.aborted) throw new Error('Import cancelled');
   report.verification=verifyArchive(db);
   if(o.mode==='create' && failed) throw new Error('Create has unresolved source failures/conflicts; nothing published');
   const finalRegistry=committedRegistry(registry,proposal,committed);
   report.status=failed?(committed.size?'partial':'failed'):'completed';
   db.prepare('INSERT INTO import_runs(id,status,report_json,registry_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,report_json=excluded.report_json,registry_json=excluded.registry_json').run(runId,report.status,JSON.stringify(report),JSON.stringify(finalRegistry));
   db.pragma('wal_checkpoint(TRUNCATE)');
   if(o.mode==='create') {db.close();db=null;publishArchive(livePath,destination);}
   if(o.manifest && committed.size) publishRegistry(o.manifest,finalRegistry,manifestHash,runId);
  } else {report.status=failed?'conflicts':'planned';report.verification=verifyArchive(db);}
 } catch(error) {report.error=error.message;report.status=committed.size && o.mode==='update'?'partial':'failed';}
 finally {
  report.finished=new Date().toISOString();
  if(db) {
   if(!o.dryRun) {
    db.exec(IMPORT_SCHEMA);
    db.prepare('INSERT INTO import_runs(id,status,report_json,registry_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,report_json=excluded.report_json').run(runId,report.status,JSON.stringify(report),JSON.stringify(committedRegistry(registry,proposal,committed)));
   }
   if(!o.dryRun && db.prepare("SELECT 1 FROM sqlite_master WHERE name='import_runs'").get()) db.prepare('UPDATE import_runs SET status=?,report_json=? WHERE id=?').run(report.status,JSON.stringify(report),runId);
   db.close();
  }
  planningDb?.close();if(detailsFd!==undefined)closeSync(detailsFd);
  if(scratch)rmSync(scratch,{recursive:true,force:true});
  releaseManifest?.();release?.();
  writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 }
 return report;
}
async function main() {
 const o=options(process.argv.slice(2));if(o.help){console.log(HELP);return;}
 const controller=new AbortController();
 const cancel=()=>controller.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
 try {
  const report=await importGames(o,{signal:controller.signal});console.log(JSON.stringify(report,null,2));
  if(!['completed','planned','inspected'].includes(report.status))process.exitCode=2;
 } finally {process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error.message);process.exitCode=1;});
