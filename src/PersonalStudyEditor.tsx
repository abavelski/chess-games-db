import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Path } from '@lichess-org/pgn-viewer/path';
import { PgnBoard, type Viewer } from './PgnBoard';
import { ReviewMoves } from './ReviewMoves';
import { reviewPgn } from './pgn.mjs';
import { useBoardResize } from './useBoardResize';
import type { StudyDraft } from './personal-studies-types';

export function PersonalStudyEditor({draft,active}:{draft:StudyDraft;active:boolean}) {
 const viewer=useRef<Viewer|null>(null),[ready,setReady]=useState(false),[path,setPath]=useState('');
 const resize=useBoardResize();
 const pgn=draft.pgn??'*',model=useMemo(()=>reviewPgn(pgn,true),[pgn]);
 const onReady=useCallback((board:Viewer|null)=>{viewer.current=board;setReady(!!board);},[]);
 const select=useCallback((value:string)=>viewer.current?.toPath(new Path(value),false),[]);
 useEffect(()=>{
  if(!active)return;
  const key=(event:KeyboardEvent)=>{
   if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,dialog,[data-board-resize],[contenteditable=true]'))return;
   const actions:Record<string,'first'|'prev'|'next'|'last'>={Home:'first',End:'last',ArrowLeft:'prev',ArrowRight:'next'};
   if(actions[event.key]){event.preventDefault();viewer.current?.goTo(actions[event.key],false);}
   else if(event.key.toLowerCase()==='f'){event.preventDefault();viewer.current?.flip();}
  };
  document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
 },[active]);
 return <div className="study-review review-workspace" ref={resize.workspace}>
  <section className="review-board" ref={resize.board} aria-label="Personal study board">
   <div className="review-board-surface"><PgnBoard pgn={pgn} review ordinalPaths reviewPath={path} onReady={onReady} onPathChange={setPath}/><button {...resize.handle} data-board-resize className="board-resize-handle" title="Resize board"/></div>
   <div ref={resize.footer} className="study-actions">
    {(['first','prev','next','last'] as const).map((direction,i)=><button key={direction} aria-label={['Study first position','Study previous move','Study next move','Study last position'][i]} disabled={!ready} onClick={()=>viewer.current?.goTo(direction,false)}>{['|←','←','→','→|'][i]}</button>)}
    <button disabled={!ready} onClick={()=>viewer.current?.flip()}>Flip study board</button>
   </div>
  </section>
  <section className="review-transcript" aria-label="Study moves"><ReviewMoves tokens={model.tokens} path={path} ready={ready} onSelect={select}/></section>
 </div>;
}
