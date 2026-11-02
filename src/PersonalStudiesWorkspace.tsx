import { useCallback, useEffect, useRef, useState } from 'react';
import type { Study, StudyDraft, StudyQuery } from './personal-studies-types';
import { StudyMetadata } from './StudyMetadata';

export const studyDraft=(study:Study):StudyDraft=>({title:study.title,kind:study.kind,pgn:study.pgn,tags:study.tags,origin_kind:study.origin_kind,origin_url:study.origin_url});

export default function PersonalStudiesWorkspace({ active }: {active: boolean}) {
 const [path,setPath]=useState(''),[error,setError]=useState('');
 const [query,setQuery]=useState<StudyQuery>({limit:40,offset:0,sort:'updated'});
 const [page,setPage]=useState<{rows:Omit<Study,'pgn'>[];total:number}>({rows:[],total:0});
 const [saved,setSaved]=useState<Study|null>(null),[draft,setDraft]=useState<StudyDraft|null>(null),[busy,setBusy]=useState(false);
 const generation=useRef(0);
 const refresh=useCallback(async()=>{const current=++generation.current;try {const result=await window.personalStudies.list(query);if(current===generation.current)setPage(result);}catch(e){if(current===generation.current)setError(String(e));}},[query]);
 useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh]);
 useEffect(()=>{window.personalStudies.status().then(s=>setPath(s.path)).catch(e=>setError(String(e)));},[]);
 async function action(run:()=>Promise<void>){setBusy(true);setError('');try{await run();await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
 function open(study:Study){setSaved(study);setDraft(studyDraft(study));}
 async function save(){if(!draft||!saved)return;const updated=await window.personalStudies.update({id:saved.id,draft:{...draft,tags:draft.tags?.filter(t=>t.trim())},expectedRevision:saved.revision});open(updated);}
 function filter(patch:StudyQuery){setQuery(q=>({...q,...patch,offset:0}));}
 return <main className="personal-studies-workspace" aria-label="My Studies" data-active={active}>
  <h1>My Studies</h1>
  {error&&<p role="alert">{error}</p>}
  <p>Private local studies. One study contains one game and its variations.</p>
  <details><summary>Local storage and help</summary><p>Storage: {path||'Opening storage…'}</p><p>Local tags and titles belong to this collection. PGN transports one game (one Lichess chapter).</p></details>
  {saved&&draft?<section aria-label="Study editor">
    <div className="study-actions"><button disabled={busy} onClick={()=>{setSaved(null);setDraft(null);}}>Back to studies</button><button disabled={busy} onClick={()=>void action(save)}>Save study</button>
    <button disabled={busy} onClick={()=>void action(async()=>open(await window.personalStudies.duplicate({id:saved.id})))}>Duplicate saved study</button>
    <button disabled={busy} onClick={()=>{if(window.confirm(`Delete “${saved.title}” permanently? This cannot be undone.`))void action(async()=>{await window.personalStudies.delete({id:saved.id,expectedRevision:saved.revision});setSaved(null);setDraft(null);});}}>Delete study</button></div>
    <StudyMetadata draft={draft} onChange={setDraft} disabled={busy}/>
  </section>:<>
   <button disabled={busy} onClick={()=>void action(async()=>open(await window.personalStudies.create({title:'Untitled study'})))}>New study</button>
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
 </main>;
}
