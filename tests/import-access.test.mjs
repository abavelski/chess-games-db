import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {desktopLease,maintenanceLease} from '../lib/archive-access.mjs';
test('desktop leases and maintenance exclude each other across all access windows',()=>{
 const dir=mkdtempSync(join(tmpdir(),'access-')),path=join(dir,'archive');writeFileSync(path,'test');
 try{const a=desktopLease(path),b=desktopLease(path);assert.throws(()=>maintenanceLease(path),/in use/);a();b();const m=maintenanceLease(path);assert.throws(()=>desktopLease(path),/in use/);assert.throws(()=>maintenanceLease(path),/in use/);m();const c=desktopLease(path);c();}finally{rmSync(dir,{recursive:true,force:true});}
});
