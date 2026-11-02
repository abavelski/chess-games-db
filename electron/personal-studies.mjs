import { join } from 'node:path';
import { openSync, readSync, closeSync, fstatSync, writeFileSync } from 'node:fs';
import { PersonalStudiesStore } from '../lib/personal-studies/storage.mjs';
import { object, validatePgn, MAX_PGN_BYTES } from '../lib/personal-studies/validation.mjs';

export function registerPersonalStudies({ app, ipcMain, authorize, dialog, getWindow, clipboard }) {
 const store=new PersonalStudiesStore(join(app.getPath('userData'),'personal-studies.sqlite3'));
 function exportText(request){object(request,['id','mode','pgn']);if(!['saved','draft'].includes(request.mode))throw Error('Choose saved or draft PGN for export.');const saved=store.get(request.id),pgn=request.mode==='saved'?saved.pgn:request.pgn;validatePgn(pgn);return pgn;}
 const actions={
  copyPgn:request=>{clipboard.writeText(exportText(request));return true;},
  savePgn:async request=>{
   const pgn=exportText(request),answer=await dialog.showSaveDialog(getWindow(),{title:`Export ${request.mode} study as one chapter PGN`,defaultPath:'study.pgn',filters:[{name:'PGN',extensions:['pgn']}]});
   if(answer.canceled||!answer.filePath)return {canceled:true};
   try{writeFileSync(answer.filePath,pgn,{encoding:'utf8',flag:'wx'});}catch(error){if(error.code==='EEXIST')throw Error('That file already exists. Choose a new filename to keep the existing export.');throw error;}
   return {canceled:false};
  },
  openPgn:async()=>{
   const answer=await dialog.showOpenDialog(getWindow(),{title:'Import one game / Lichess chapter PGN',properties:['openFile'],filters:[{name:'PGN',extensions:['pgn']}]});
   if(answer.canceled||!answer.filePaths.length)return {canceled:true};
   const fd=openSync(answer.filePaths[0],'r');
   try{
    if(!fstatSync(fd).isFile()||fstatSync(fd).size>MAX_PGN_BYTES)throw Error('Select a PGN file up to 2 MiB.');
    const data=Buffer.alloc(MAX_PGN_BYTES+1);let size=0,n;
    while(size<data.length&&(n=readSync(fd,data,size,data.length-size,null))>0)size+=n;
    if(size>MAX_PGN_BYTES)throw Error('PGN file exceeds 2 MiB.');
    let pgn;try{pgn=new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(0,size));}catch{throw Error('PGN file must use UTF-8 encoding.');}
    validatePgn(pgn);return {canceled:false,pgn};
   }finally{closeSync(fd);}
  },
  status:()=>{store.open();return {path:store.path,schemaVersion:1};},
  list:request=>store.list(request),
  get:request=>{object(request,['id']);return store.get(request.id);},
  create:request=>store.create(request),
  update:request=>{object(request,['id','draft','expectedRevision']);return store.update(request.id,request.draft,request.expectedRevision);},
  duplicate:request=>{object(request,['id']);return store.duplicate(request.id);},
  delete:request=>{object(request,['id','expectedRevision']);return store.delete(request.id,request.expectedRevision);},
 };
 for(const [action,run] of Object.entries(actions))ipcMain.handle('personal-studies:'+action,(event,request)=>{
  if(!authorize(event))throw Error('Personal studies access denied.');
  const fail=error=>{
   // SQLite errors may contain schema details; expose only our actionable errors.
   if(error.code?.startsWith('SQLITE'))throw Error('Personal studies storage failed. Check disk space and permissions; your draft has not been discarded.');
   throw Error(error.message);
  };
  try{const result=run(request);return result instanceof Promise?result.catch(fail):result;}catch(error){return fail(error);}
 });
 return {close:()=>store.close()};
}
