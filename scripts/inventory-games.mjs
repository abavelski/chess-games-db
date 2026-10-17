import Database from 'better-sqlite3';
import { inventory } from '../lib/game-policy.mjs';
const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });
try { console.log(JSON.stringify(db.transaction(() => inventory(db))(), null, 2)); }
finally { db.close(); }
