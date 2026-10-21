import Database from 'better-sqlite3';
import { applySource, assertImportCompatible } from '../lib/import/apply.mjs';
import { prepareImportStorage } from '../lib/import/storage.mjs';
process.once('message',({path,stagePath,entry,extraction,options})=>{
 let db,stage;
 try {
  db=new Database(path);db.pragma('foreign_keys=ON');db.pragma('busy_timeout=0');
  assertImportCompatible(db);prepareImportStorage(db);
  stage=new Database(stagePath,{readonly:true,fileMustExist:true});
  const result=applySource(db,stage,entry,extraction,options);
  process.send({result});
 }catch(error){process.send({error:error.message});process.exitCode=1;}
 finally{stage?.close();db?.close();process.disconnect();}
});
