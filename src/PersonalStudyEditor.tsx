import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Path } from '@lichess-org/pgn-viewer/path';
import { PgnBoard, type Viewer } from './PgnBoard';
import { ReviewMoves } from './ReviewMoves';
import { reviewPgn } from './pgn.mjs';
import { useBoardResize } from './useBoardResize';
import { chessgroundDests } from 'chessops/compat';
import { parseSquare } from 'chessops/util';
import { parseStudy, serializeStudy, identityAtPath, pathForIdentity, positionById } from '../lib/personal-studies/pgn.mjs';
import { addMove, deleteMove } from '../lib/personal-studies/edits.mjs';
import { annotation, setComment, setNags, drawings, setDrawings, type StudyShape } from '../lib/personal-studies/annotations.mjs';
import type { StudyDraft } from './personal-studies-types';

export function PersonalStudyEditor({draft,active,onChange,disabled=false}:{draft:StudyDraft;active:boolean;onChange:(draft:StudyDraft)=>void;disabled?:boolean}) {
 const viewer=useRef<Viewer|null>(null),[ready,setReady]=useState(false),[path,setPath]=useState('');
 const resize=useBoardResize();
 const pgn=draft.pgn??'*',model=useMemo(()=>reviewPgn(pgn,true),[pgn]);
 const [initialTree]=useState(()=>parseStudy(pgn));
 const tree=useRef({pgn,tree:initialTree});
 if(tree.current.pgn!==pgn)tree.current={pgn,tree:parseStudy(pgn)};
 const [moveInput,setMoveInput]=useState(''),[error,setError]=useState(''),[promotion,setPromotion]=useState<{from:string;to:string}|null>(null);
 const selectedId=identityAtPath(tree.current.tree,path),notes=annotation(tree.current.tree,selectedId);
 const [brush,setBrush]=useState('green'),[origin,setOrigin]=useState(''),[destination,setDestination]=useState('');
 function commit(id:string){const output=serializeStudy(tree.current.tree),target=pathForIdentity(tree.current.tree,id);tree.current.pgn=output;setPath(target);onChange({...draft,pgn:output});if(viewer.current?.game.nodeAt(new Path(target)))viewer.current.toPath(new Path(target),false);}
 function play(input:string){try {const id=addMove(tree.current.tree,identityAtPath(tree.current.tree,path),input);commit(id);setMoveInput('');setPromotion(null);setError('');}catch(e){setError(String(e));viewer.current?.toPath(new Path(path),false);}}
 function draw(shapes:StudyShape[]){try{setDrawings(tree.current.tree,selectedId,shapes);commit(selectedId);setError('');}catch(e){setError(String(e));}}
 const handlers=useRef({play,draw});handlers.current={play,draw};
 const configureBoard=useCallback((board:Viewer)=>{
  const current=positionById(tree.current.tree,identityAtPath(tree.current.tree,board.path.path));
  board.ground?.set({drawable:{enabled:active&&!disabled,visible:true,shapes:drawings(tree.current.tree,current.node.id),onChange:shapes=>handlers.current.draw(shapes.filter(s=>['green','red','blue','yellow'].includes(s.brush??'')).map(s=>({brush:s.brush!,orig:s.orig,dest:s.dest})))},turnColor:current.pos.turn,movable:{free:false,color:active&&!disabled?current.pos.turn:undefined,dests:active&&!disabled?chessgroundDests(current.pos):new Map(),events:{after:(from,to)=>{
   if(current.pos.board.get(parseSquare(from)!)?.role==='pawn'&&['1','8'].includes(to[1])){board.toPath(board.path,false);setPromotion({from,to});}
   else handlers.current.play(from+to);
  }}},draggable:{enabled:active&&!disabled},selectable:{enabled:active&&!disabled},premovable:{enabled:false}});
 },[active,disabled,pgn]);
 const onReady=useCallback((board:Viewer|null)=>{viewer.current=board;setReady(!!board);},[]);
 const select=useCallback((value:string)=>viewer.current?.toPath(new Path(value),false),[]);
 useEffect(()=>{
  if(!active)return;
  const key=(event:KeyboardEvent)=>{
   if(promotion||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,dialog,[data-board-resize],[contenteditable=true]'))return;
   const actions:Record<string,'first'|'prev'|'next'|'last'>={Home:'first',End:'last',ArrowLeft:'prev',ArrowRight:'next'};
   if(actions[event.key]){event.preventDefault();viewer.current?.goTo(actions[event.key],false);}
   else if(event.key.toLowerCase()==='f'){event.preventDefault();viewer.current?.flip();}
  };
  document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
 },[active,promotion]);
 return <div className="study-review review-workspace" ref={resize.workspace}>
  <section className="review-board" ref={resize.board} aria-label="Personal study board">
   <div className="review-board-surface"><PgnBoard pgn={pgn} review ordinalPaths reviewPath={path} onReady={onReady} onPathChange={setPath} configureBoard={configureBoard}/><button {...resize.handle} data-board-resize className="board-resize-handle" title="Resize board"/></div>
   <div ref={resize.footer} className="study-actions">
    {(['first','prev','next','last'] as const).map((direction,i)=><button key={direction} aria-label={['Study first position','Study previous move','Study next move','Study last position'][i]} disabled={!ready} onClick={()=>viewer.current?.goTo(direction,false)}>{['|←','←','→','→|'][i]}</button>)}
    <button disabled={!ready} onClick={()=>viewer.current?.flip()}>Flip study board</button>
   </div>
   <form onSubmit={e=>{e.preventDefault();play(moveInput);}}><label>Enter move (SAN or UCI)<input aria-label="Study move" value={moveInput} onChange={e=>setMoveInput(e.target.value)} disabled={disabled}/></label><button disabled={disabled||!moveInput}>Add move</button></form>
   <button disabled={disabled||!path} onClick={()=>{try{commit(deleteMove(tree.current.tree,identityAtPath(tree.current.tree,path)));}catch(e){setError(String(e));}}}>Delete selected move and descendants</button>
   <details><summary>Arrows and square highlights</summary><p>Right-drag for an arrow; right-click a square to highlight it. Use Shift/Alt/Ctrl with the right button for other colors, or use the controls below. Repeat a drawing to remove it.</p>
    <label>Drawing color<select aria-label="Study drawing color" value={brush} onChange={e=>setBrush(e.target.value)}>{['green','red','blue','yellow'].map(color=><option key={color}>{color}</option>)}</select></label>
    <label>From square<input aria-label="Study drawing origin" maxLength={2} value={origin} onChange={e=>setOrigin(e.target.value)}/></label>
    <label>To square (empty for highlight)<input aria-label="Study drawing destination" maxLength={2} value={destination} onChange={e=>setDestination(e.target.value)}/></label>
    <button disabled={disabled} onClick={()=>{const shape={brush,orig:origin,dest:destination||undefined} as StudyShape,current=drawings(tree.current.tree,selectedId),has=current.some(s=>s.brush===brush&&s.orig===origin&&s.dest===(destination||undefined));draw(has?current.filter(s=>!(s.brush===brush&&s.orig===origin&&s.dest===(destination||undefined))):[...current,shape]);}}>Toggle drawing</button>
    <button disabled={disabled} onClick={()=>draw([])}>Clear position drawings</button>
   </details>
   {error&&<p role="alert">{error}</p>}
   {promotion&&<Promotion onPick={suffix=>play(promotion.from+promotion.to+suffix)} onCancel={()=>setPromotion(null)}/>}
  </section>
  <section className="review-transcript" aria-label="Study moves"><ReviewMoves tokens={model.tokens} path={path} ready={ready} onSelect={select}/>
   <fieldset disabled={disabled}><legend>{path?'Selected position annotations':'Starting position notes'}</legend>
    <label>Position comment<textarea aria-label="Study position comment" maxLength={24000} value={notes.text} onChange={e=>{try{setComment(tree.current.tree,selectedId,e.target.value);commit(selectedId);setError('');}catch(error){setError(String(error));}}}/></label>
    <label>Numeric move glyphs (comma separated)<input aria-label="Study NAGs" key={selectedId+':'+notes.nags.join(',')} disabled={!path} defaultValue={notes.nags.join(',')} onBlur={e=>{try{setNags(tree.current.tree,selectedId,e.target.value.trim()?e.target.value.split(',').map(Number):[]);commit(selectedId);setError('');}catch(error){setError(String(error));}}}/></label>
    <div className="study-actions">{['!','?','!!','??','!?','?!'].map((glyph,index)=><button key={glyph} disabled={!path} aria-pressed={notes.nags.includes(index+1)} onClick={()=>{setNags(tree.current.tree,selectedId,notes.nags.includes(index+1)?notes.nags.filter(n=>n!==index+1):[...notes.nags,index+1]);commit(selectedId);}}>{glyph}</button>)}</div>
   </fieldset>
  </section>
 </div>;
}

function Promotion({onPick,onCancel}:{onPick:(suffix:string)=>void;onCancel:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{dialog.current?.showModal();},[]);
 return <dialog ref={dialog} onCancel={onCancel} aria-label="Choose promotion"><p>Promote pawn to</p>{['q','r','b','n'].map((suffix,i)=><button key={suffix} autoFocus={i===0} onClick={()=>onPick(suffix)}>{['Queen','Rook','Bishop','Knight'][i]}</button>)}<button onClick={onCancel}>Cancel promotion</button></dialog>;
}
