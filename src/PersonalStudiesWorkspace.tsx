import { useCallback, useEffect, useRef, useState } from 'react';
import type { Study, StudyDraft, StudyQuery } from './personal-studies-types';
import { StudyMetadata } from './StudyMetadata';
import { PersonalStudyEditor } from './PersonalStudyEditor';
import { StudyImportDialog } from './StudyImportDialog';

export const studyDraft=(study:Study):StudyDraft=>({title:study.title,kind:study.kind,pgn:study.pgn,tags:study.tags,origin_kind:study.origin_kind,origin_url:study.origin_url});

export default function PersonalStudiesWorkspace({ active }: {active: boolean}) {
 const [path,setPath]=useState(''),[error,setError]=useState('');
 const [query,setQuery]=useState<StudyQuery>({limit:40,offset:0,sort:'updated'});
 const [importing,setImporting]=useState(false);
 const [exportMode,setExportMode]=useState<'saved'|'draft'>('saved'),[notice,setNotice]=useState('');
 const [page,setPage]=useState<{rows:Omit<Study,'pgn'>[];total:number}>({rows:[],total:0});
 const [saved,setSaved]=useState<Study|null>(null),[draft,setDraft]=useState<StudyDraft|null>(null),[busy,setBusy]=useState(false);
 const savedRef=useRef(saved);savedRef.current=saved;
 const [pendingLeave,setPendingLeave]=useState<(()=>void)|null>(null),[editorEpoch,setEditorEpoch]=useState(0);
 const dirty=!!saved&&!!draft&&JSON.stringify(draft)!==JSON.stringify(studyDraft(saved));
 const blocked=useRef(false);blocked.current=dirty||busy;
 const leaveRef=useRef<(proceed:()=>void)=>void>(()=>{});
 function leave(proceed:()=>void){if(blocked.current)setPendingLeave(()=>proceed);else proceed();}
 leaveRef.current=leave;
 useEffect(()=>{
  const request=(event:Event)=>{if(blocked.current){event.preventDefault();leaveRef.current((event as CustomEvent<()=>void>).detail);}};
  const unload=(event:BeforeUnloadEvent)=>{if(blocked.current){event.preventDefault();event.returnValue='';}};
  window.addEventListener('personal-studies:leave',request);window.addEventListener('beforeunload',unload);
  const off=window.personalStudies.onCloseRequest(()=>leaveRef.current(()=>window.close()));
  return()=>{window.removeEventListener('personal-studies:leave',request);window.removeEventListener('beforeunload',unload);off();};
 },[]);
 const generation=useRef(0);
 const refresh=useCallback(async()=>{const current=++generation.current;try {const result=await window.personalStudies.list(query);if(current===generation.current)setPage(result);}catch(e){if(current===generation.current)setError(String(e));}},[query]);
 useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh]);
 useEffect(()=>{window.personalStudies.status().then(s=>setPath(s.path)).catch(e=>setError(String(e)));},[]);
 async function action(run:()=>Promise<void>){setBusy(true);setError('');try{await run();await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
 function open(study:Study){savedRef.current=study;setSaved(study);setDraft(studyDraft(study));setNotice('');}
 function deleteSaved(){const target=savedRef.current;if(target&&window.confirm(`Delete “${target.title}” permanently? This cannot be undone.`))void action(async()=>{await window.personalStudies.delete({id:target.id,expectedRevision:target.revision});setSaved(null);setDraft(null);});}
 async function save(){if(!draft||!saved)return;const updated=await window.personalStudies.update({id:saved.id,draft:{...draft,tags:draft.tags?.filter(t=>t.trim())},expectedRevision:saved.revision});open(updated);blocked.current=false;}
 async function saveAndLeave(){const proceed=pendingLeave;if(!proceed)return;setBusy(true);setError('');try{await save();await refresh();setPendingLeave(null);setBusy(false);blocked.current=false;setTimeout(proceed,0);}catch(e){setError(String(e));}finally{setBusy(false);}}
 function filter(patch:StudyQuery){setQuery(q=>({...q,...patch,offset:0}));}
 return <main className="personal-studies-workspace" aria-label="My Studies" data-active={active}>
  <h1>My Studies</h1>
  {error&&<p role="alert">{error}</p>}
  <p>Private local studies. One study contains one game and its variations.</p>
  <details><summary>Local storage and help</summary><p>Storage: {path||'Opening storage…'}</p><p>Local tags and titles belong to this collection. PGN transports one game (one Lichess chapter).</p>
   <button disabled={busy} onClick={()=>void action(async()=>{const answer=await window.personalStudies.backup();if(!answer.canceled)setNotice('Full saved personal studies collection backed up. Unsaved drafts are not included.');})}>Back up entire studies database</button>
   <p>A database backup includes every saved study, metadata and tags. A chapter PGN export includes one game. Unsaved drafts are excluded from both saved exports and backups.</p>
   <p>Restore: close the app first, preserve a backup of the current database, then replace personal-studies.sqlite3 at the path above with a verified database backup. Remove its old -wal and -shm sidecars only while the app is closed. Reopen the app. Restoring replaces all newer local studies; it does not merge collections or change Games/Openings.</p>
   {notice&&<p role="status">{notice}</p>}
  </details>
  {saved&&draft?<section aria-label="Study editor">
    <p role="status" className="study-save-status">{busy?'Saving or loading…':dirty?'Unsaved changes':`Saved · revision ${saved.revision}`}</p>
    <div className="study-actions"><label>PGN export version<select aria-label="PGN export version" value={exportMode} onChange={e=>setExportMode(e.target.value as 'saved'|'draft')}><option value="saved">Saved study</option><option value="draft">Current draft (includes unsaved changes)</option></select></label>
     <button disabled={busy} onClick={()=>void action(async()=>{await window.personalStudies.copyPgn({id:saved.id,mode:exportMode,pgn:exportMode==='draft'?draft.pgn:undefined});setNotice(`Copied ${exportMode} chapter PGN.`);})}>Copy chapter PGN</button>
     <button disabled={busy} onClick={()=>void action(async()=>{const answer=await window.personalStudies.savePgn({id:saved.id,mode:exportMode,pgn:exportMode==='draft'?draft.pgn:undefined});if(!answer.canceled)setNotice(`Exported ${exportMode} chapter PGN.`);})}>Export chapter PGN</button>
     {notice&&<span role="status">{notice}</span>}
    </div>
    <div className="study-actions"><button disabled={busy} onClick={()=>leave(()=>{setSaved(null);setDraft(null);})}>Back to studies</button><button disabled={busy} onClick={()=>void action(save)}>Save study</button>
    <button disabled={busy} onClick={()=>leave(()=>void action(async()=>open(await window.personalStudies.duplicate({id:saved.id}))))}>Duplicate saved study</button>
    <button disabled={busy} onClick={()=>leave(deleteSaved)}>Delete study</button></div>
    <PersonalStudyEditor key={saved.id+':'+editorEpoch} draft={draft} active={active} onChange={setDraft} disabled={busy}/>
    <StudyMetadata draft={draft} onChange={setDraft} disabled={busy}/>
  </section>:<>
   <button disabled={busy} onClick={()=>void action(async()=>open(await window.personalStudies.create({title:'Untitled study'})))}>New study</button>
   <button disabled={busy} onClick={()=>setImporting(true)}>Import chapter PGN</button>
   <div className="study-filters">
    <label>Search title, player or event<input aria-label="Search studies" value={query.search??''} onChange={e=>filter({search:e.target.value})}/></label>
    <label>Year<input aria-label="Filter study year" type="number" min={1} max={9999} value={query.year??''} onChange={e=>filter({year:e.target.value?Number(e.target.value):undefined})}/></label>
    <label>Kind<select aria-label="Filter study kind" value={query.kind??''} onChange={e=>filter({kind:e.target.value||undefined})}><option value="">All kinds</option><option value="tournament">Tournament</option><option value="other">Other</option></select></label>
    <label>Tags (all must match)<input aria-label="Filter study tags" value={(query.tags??[]).join(',')} onChange={e=>filter({tags:e.target.value.split(',').filter(t=>t.trim())})}/></label>
    <label>Sort<select aria-label="Sort studies" value={query.sort} onChange={e=>filter({sort:e.target.value})}><option value="updated">Recently edited</option><option value="created">Recently created</option><option value="title">Title</option></select></label>
   </div>
   <p role="status">{page.total} studies</p>
   {!page.total&&<p>No studies match. Create a study or adjust the filters.</p>}
   <ul className="study-list">{page.rows.map(study=><li key={study.id}><button disabled={busy} onClick={()=>void action(async()=>open(await window.personalStudies.get({id:study.id})))}>{study.title}</button><span>{[study.white,study.black,study.event,study.year,study.tags.join(', ')].filter(Boolean).join(' · ')}</span></li>)}</ul>
   <button disabled={!query.offset||busy} onClick={()=>setQuery(q=>({...q,offset:Math.max(0,(q.offset??0)-40)}))}>Previous studies</button>
   <button disabled={(query.offset??0)+40>=page.total||busy} onClick={()=>setQuery(q=>({...q,offset:(q.offset??0)+40}))}>Next studies</button>
  </>}
  {importing&&<StudyImportDialog onBusy={setBusy} onClose={()=>setImporting(false)} onImport={async value=>{open(await window.personalStudies.create(value));await refresh();}}/>}
  {pendingLeave&&<LeaveDialog busy={busy} onCancel={()=>setPendingLeave(null)} onDiscard={()=>{if(saved)setDraft(studyDraft(saved));blocked.current=false;setEditorEpoch(e=>e+1);const proceed=pendingLeave;setPendingLeave(null);setTimeout(proceed,0);}} onSave={()=>void saveAndLeave()}/>}
 </main>;
}

function LeaveDialog({busy,onCancel,onDiscard,onSave}:{busy:boolean;onCancel:()=>void;onDiscard:()=>void;onSave:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null);useEffect(()=>{dialog.current?.showModal();},[]);
 return <dialog ref={dialog} aria-label="Unsaved study changes" onCancel={e=>{e.preventDefault();onCancel();}}><h2>Unsaved study changes</h2><p>{busy?'A write is pending. Wait for it to finish before leaving.':'Save your changes before leaving this study?'}</p><button disabled={busy} onClick={onSave}>Save and leave</button><button disabled={busy} onClick={onDiscard}>Discard and leave</button><button autoFocus onClick={onCancel}>Cancel leaving</button></dialog>;
}
