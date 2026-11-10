import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { text, object, tags, validatePgn, metadata } from './validation.mjs';

export const APPLICATION_ID = 0x50535444;
export const SCHEMA_VERSION = 1;
export const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Deliberately independent of every archive/opening migration.
const schema = `
CREATE TABLE studies (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('tournament','other')),
 root_fen TEXT NOT NULL, pgn TEXT NOT NULL,
 white TEXT, black TEXT, white_elo INTEGER, black_elo INTEGER, event TEXT, site TEXT,
 date TEXT, round TEXT, result TEXT, eco TEXT, annotator TEXT, year INTEGER,
 origin_kind TEXT, origin_url TEXT,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE study_tags (
 study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
 tag_key TEXT NOT NULL, label TEXT NOT NULL, PRIMARY KEY(study_id,tag_key)
);
CREATE INDEX studies_updated_idx ON studies(updated_at DESC,id);
CREATE INDEX studies_year_idx ON studies(year,id);
CREATE INDEX studies_kind_idx ON studies(kind,id);
CREATE INDEX studies_white_idx ON studies(white,id);
CREATE INDEX studies_black_idx ON studies(black,id);
CREATE INDEX studies_event_idx ON studies(event,id);
CREATE INDEX study_tags_tag_idx ON study_tags(tag_key,study_id);
`;

export class PersonalStudiesStore {
  constructor(path) { this.path = path; this.db = null; }

  open() {
    if (this.db) return this.db;
    let db;
    try {
      const existing = existsSync(this.path);
      if (existing) {
        // Validate read-only first, before WAL or any migration may modify it.
        db = new Database(this.path, { readonly: true, fileMustExist: true });
        if (db.pragma('application_id', { simple: true }) !== APPLICATION_ID) throw new Error('This is not a personal studies database. Restore a verified studies backup.');
        const version = db.pragma('user_version', { simple: true });
        if (version !== SCHEMA_VERSION) throw new Error(`Unsupported personal studies schema ${version}. Use a compatible app version or restore a verified backup.`);
        if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Personal studies database is corrupt. Restore a verified backup.');
        db.prepare('SELECT id,pgn,revision FROM studies LIMIT 0').all();
        db.prepare('SELECT study_id,tag_key,label FROM study_tags LIMIT 0').all();
        db.close(); db = null;
      } else mkdirSync(dirname(this.path), { recursive: true });
      db = new Database(this.path);
      db.pragma('foreign_keys=ON');
      if (!existing) db.transaction(() => {
        db.exec(schema);
        db.pragma(`application_id=${APPLICATION_ID}`);
        db.pragma(`user_version=${SCHEMA_VERSION}`);
      })();
      db.pragma('journal_mode=WAL');
      this.db = db;
      return db;
    } catch (error) {
      db?.close();
      if (/personal studies|compatible app/.test(error.message)) throw error;
      throw new Error('Cannot open personal studies storage. Check disk permissions or restore a verified backup.', { cause: error });
    }
  }

  close() { this.db?.close(); this.db = null; }

  async backup(destination) {
    const db=this.open(),temporary=destination+'.'+randomUUID()+'.partial';
    // Reserve our own temporary file, then publish with an exclusive hard link.
    // A live WAL database must never be copied with ordinary filesystem copy.
    writeFileSync(temporary,'',{flag:'wx'});
    try {
      await db.backup(temporary);
      const verify=new Database(temporary,{readonly:true,fileMustExist:true});
      try{if(verify.pragma('application_id',{simple:true})!==APPLICATION_ID||verify.pragma('user_version',{simple:true})!==SCHEMA_VERSION||verify.pragma('integrity_check',{simple:true})!=='ok'||verify.pragma('foreign_key_check').length)throw Error('Backup verification failed.');}finally{verify.close();}
      try{linkSync(temporary,destination);}catch(error){if(error.code==='EEXIST')throw Error('Backup destination already exists. Choose a new filename.');throw error;}
      return true;
    } finally {unlinkSync(temporary);}
  }

  get(id) {
    text(id,'study ID',100);
    const db=this.open(),row=db.prepare('SELECT * FROM studies WHERE id=?').get(id);
    if(!row)throw Error('Study not found. Refresh the list.');
    row.tags=db.prepare('SELECT label FROM study_tags WHERE study_id=? ORDER BY tag_key').all(id).map(t=>t.label);
    return row;
  }

  list(request={}) {
    object(request,['search','kind','year','tags','sort','offset','limit']);
    const limit=request.limit??40,offset=request.offset??0;
    if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>1_000_000)throw Error('Invalid studies page.');
    const clauses=[],values=[];
    if(request.search!==undefined){const search=text(request.search,'search',200,true);if(search){clauses.push("(instr(lower(title),lower(?)) OR instr(lower(coalesce(white,'')),lower(?)) OR instr(lower(coalesce(black,'')),lower(?)) OR instr(lower(coalesce(event,'')),lower(?)))");values.push(search,search,search,search);}}
    if(request.kind){if(!['tournament','other'].includes(request.kind))throw Error('Invalid study kind.');clauses.push('kind=?');values.push(request.kind);}
    if(request.year!==undefined&&request.year!==null){if(!Number.isInteger(request.year)||request.year<1||request.year>9999)throw Error('Invalid year.');clauses.push('year=?');values.push(request.year);}
    for(const tag of tags(request.tags)){clauses.push('EXISTS(SELECT 1 FROM study_tags WHERE study_id=studies.id AND tag_key=?)');values.push(tag.key);}
    const sorts={updated:'updated_at DESC,id',title:'title COLLATE NOCASE,id',created:'created_at DESC,id'};
    const sortKey=request.sort??'updated';if(!Object.hasOwn(sorts,sortKey))throw Error('Invalid studies sort.');const sort=sorts[sortKey];
    const where=clauses.length?' WHERE '+clauses.join(' AND '):'',db=this.open();
    const total=db.prepare('SELECT count(*) total FROM studies'+where).get(...values).total;
    const columns='id,title,kind,root_fen,white,black,white_elo,black_elo,event,site,date,round,result,eco,annotator,year,origin_kind,origin_url,revision,created_at,updated_at';
    const rows=db.prepare('SELECT '+columns+' FROM studies'+where+' ORDER BY '+sort+' LIMIT ? OFFSET ?').all(...values,limit,offset);
    const labels=db.prepare('SELECT label FROM study_tags WHERE study_id=? ORDER BY tag_key');
    for(const row of rows)row.tags=labels.all(row.id).map(t=>t.label);
    return {rows,total,offset,limit};
  }

  write(draft, id, expectedRevision) {
    object(draft,['title','kind','pgn','tags','origin_kind','origin_url']);
    const title=text(draft.title,'title',200),kind=draft.kind??'other';
    if(!['tournament','other'].includes(kind))throw Error('Invalid study kind.');
    const pgn=draft.pgn??'*',fields=metadata(validatePgn(pgn)),labels=tags(draft.tags);
    const origin_kind=draft.origin_kind??'blank';if(!['blank','pgn-file','pgn-paste','lichess-pgn','kindle-play'].includes(origin_kind))throw Error('Invalid study origin.');
    const origin_url=text(draft.origin_url,'origin URL',1000,true);
    if(origin_url&&!/^https:\/\/lichess\.org\/study\/[A-Za-z0-9]{8}(?:\/[A-Za-z0-9]{8})?\/?$/.test(origin_url))throw Error('Use a Lichess study/chapter URL for provenance.');
    if(id && (!Number.isSafeInteger(expectedRevision)||expectedRevision<1))throw Error('Invalid expectedRevision.');
    const db=this.open(),now=new Date().toISOString(),studyId=id??randomUUID();
    return db.transaction(()=>{
      const row={id:studyId,title,kind,root_fen:STANDARD_FEN,pgn,...fields,origin_kind,origin_url,updated_at:now};
      if(id){
        const changes=db.prepare('UPDATE studies SET '+Object.keys(row).filter(k=>k!=='id').map(k=>`${k}=@${k}`).join(',')+',revision=revision+1 WHERE id=@id AND revision=@expectedRevision').run({...row,expectedRevision}).changes;
        if(!changes)throw Error('Study revision conflict or missing study. Your draft is retained; reload a separate copy before retrying.');
      }else{
        row.created_at=now;const keys=Object.keys(row);db.prepare('INSERT INTO studies('+keys.join(',')+') VALUES('+keys.map(k=>'@'+k).join(',')+')').run(row);
      }
      db.prepare('DELETE FROM study_tags WHERE study_id=?').run(studyId);
      const insert=db.prepare('INSERT INTO study_tags VALUES(?,?,?)');for(const tag of labels)insert.run(studyId,tag.key,tag.label);
      return this.get(studyId);
    })();
  }

  create(draft) { return this.write(draft); }
  update(id,draft,expectedRevision) {text(id,'study ID',100);return this.write(draft,id,expectedRevision);}
  duplicate(id) {const saved=this.get(id);return this.create({title:(saved.title+' (copy)').slice(0,200),kind:saved.kind,pgn:saved.pgn,tags:saved.tags,origin_kind:saved.origin_kind,origin_url:saved.origin_url});}
  delete(id,expectedRevision) {
    text(id,'study ID',100);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw Error('Invalid expectedRevision.');
    if(!this.open().prepare('DELETE FROM studies WHERE id=? AND revision=?').run(id,expectedRevision).changes)throw Error('Study revision conflict or missing study. Refresh before deleting.');
    return true;
  }
}
