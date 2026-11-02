import { useEffect, useRef, useState } from 'react';
import type { StudyDraft } from './personal-studies-types';

export function StudyImportDialog({onImport,onClose}:{onImport:(draft:StudyDraft)=>Promise<void>;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null);
 const [pgn,setPgn]=useState(''),[title,setTitle]=useState('Imported chapter'),[tags,setTags]=useState(''),[url,setUrl]=useState(''),[file,setFile]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{dialog.current?.showModal();},[]);
 async function choose(){setBusy(true);setError('');try{const answer=await window.personalStudies.openPgn();if(!answer.canceled){setPgn(answer.pgn!);setFile(true);}}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function submit(){setBusy(true);setError('');try{await onImport({title,pgn,tags:tags.split(',').filter(t=>t.trim()),origin_kind:url?'lichess-pgn':file?'pgn-file':'pgn-paste',origin_url:url||null});onClose();}catch(e){setError(String(e));}finally{setBusy(false);}}
 return <dialog ref={dialog} aria-label="Import chapter PGN" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}><h2>Import one game / Lichess chapter</h2><p>In Lichess, export Chapter PGN with comments and variations. Import works offline and creates a new local study.</p>
  {error&&<p role="alert">{error}</p>}
  <fieldset disabled={busy}><label>Local title<input aria-label="Import study title" value={title} onChange={e=>setTitle(e.target.value)}/></label>
  <label>Local tags<input value={tags} onChange={e=>setTags(e.target.value)}/></label>
  <label>Optional Lichess source URL (provenance only)<input aria-label="Import source URL" value={url} onChange={e=>setUrl(e.target.value)}/></label>
  <button onClick={()=>void choose()}>Choose PGN file</button><label>Paste one-game PGN<textarea aria-label="Import PGN text" rows={10} value={pgn} onChange={e=>{setPgn(e.target.value);setFile(false);}}/></label>
  <button disabled={!pgn.trim()} onClick={()=>void submit()}>Import as new study</button><button onClick={onClose}>Cancel import</button></fieldset>
 </dialog>;
}
