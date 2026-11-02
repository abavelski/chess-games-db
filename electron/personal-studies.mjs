import { join } from 'node:path';
import { PersonalStudiesStore } from '../lib/personal-studies/storage.mjs';
import { object } from '../lib/personal-studies/validation.mjs';

export function registerPersonalStudies({ app, ipcMain, authorize }) {
 const store=new PersonalStudiesStore(join(app.getPath('userData'),'personal-studies.sqlite3'));
 const actions={
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
  try{return run(request);}catch(error){
   // SQLite errors may contain schema details; expose only our actionable errors.
   if(error.code?.startsWith('SQLITE'))throw Error('Personal studies storage failed. Check disk space and permissions; your draft has not been discarded.');
   throw Error(error.message);
  }
 });
 return {close:()=>store.close()};
}
