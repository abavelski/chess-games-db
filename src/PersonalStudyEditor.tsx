import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Path } from '@lichess-org/pgn-viewer/path';
import { PgnBoard, type Viewer } from './PgnBoard';
import { ReviewMoves } from './ReviewMoves';
import { reviewPgn } from './pgn.mjs';
import { useBoardResize } from './useBoardResize';
import { chessgroundDests } from 'chessops/compat';
import { parseSquare, makeUci } from 'chessops/util';
import { parseSan } from 'chessops/san';
import { INITIAL_FEN } from 'chessops/fen';
import { parseStudy, serializeStudy, identityAtPath, pathForIdentity, positionById, positions } from '../lib/personal-studies/pgn.mjs';
import { addMove, deleteMove, addContinuation } from '../lib/personal-studies/edits.mjs';
import { replayPosition } from './analysis.mjs';
import { useEngineAnalysis } from './useEngineAnalysis';
import { EnginePanel, readReviewPreferences, type ReviewDisplay } from './EnginePanel';
import type { AnalysisOptions } from './engine-types';
import { PieceMode } from './PieceMode';
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
 const [options,setOptions]=useState<AnalysisOptions>({stockfish:false,maia:false,lines:3,maiaLines:5,rating:1500,revision:0});
 const [display,setDisplay]=useState<ReviewDisplay>(()=>readReviewPreferences().display);
 const [pieceMode,setPieceMode]=useState(false),[suggestion,setSuggestion]=useState<{id:string;moves:string[]}|null>(null);
 const position=useMemo(()=>{
  const entries=new Map(positions(tree.current.tree).map(e=>[e.path,e])),moves:string[]=[];
  for(let length=2;length<=path.length;length+=2){const parent=entries.get(path.slice(0,length-2)),child=entries.get(path.slice(0,length));if(!parent||!child)break;moves.push(makeUci(parseSan(parent.pos,child.node.data!.san)!));}
  return replayPosition(INITIAL_FEN,moves);
 },[pgn,path]);
 const engines=useEngineAnalysis(position,options,!active||pieceMode||disabled);
 function commit(id:string){const output=serializeStudy(tree.current.tree),target=pathForIdentity(tree.current.tree,id);tree.current.pgn=output;setPath(target);onChange({...draft,pgn:output});if(viewer.current?.game.nodeAt(new Path(target)))viewer.current.toPath(new Path(target),false);}
 function play(input:string){try {const id=addMove(tree.current.tree,identityAtPath(tree.current.tree,path),input);commit(id);setMoveInput('');setPromotion(null);setError('');}catch(e){setError(String(e));viewer.current?.toPath(new Path(path),false);}}
 function draw(shapes:StudyShape[]){try{setDrawings(tree.current.tree,selectedId,shapes);commit(selectedId);setError('');}catch(e){setError(String(e));}}
 const handlers=useRef({play,draw});handlers.current={play,draw};
 const configureBoard=useCallback((board:Viewer)=>{
  const current=positionById(tree.current.tree,identityAtPath(tree.current.tree,board.path.path));
  const autoShapes:StudyShape[]=[];
  const arrows=(moves:string[],brush:string)=>{for(const uci of moves){if(/^[a-h][1-8][a-h][1-8]/.test(uci))autoShapes.push({orig:uci.slice(0,2),dest:uci.slice(2,4),brush} as StudyShape);}};
  if(active&&!pieceMode){if(options.stockfish&&display.arrows)arrows(engines.stockfish.lines.map(line=>line.moves[0]),'engine');if(options.maia&&display.maiaArrows)arrows(engines.maia.candidates.map(c=>c.move),'human');}
  board.ground?.set({drawable:{enabled:active&&!disabled,visible:true,autoShapes,brushes:{...board.ground.state.drawable.brushes,engine:{key:'engine',color:'#27854c',opacity:.75,lineWidth:9},human:{key:'human',color:'#9155c2',opacity:.9,lineWidth:5}},shapes:drawings(tree.current.tree,current.node.id),onChange:shapes=>handlers.current.draw(shapes.filter(s=>['green','red','blue','yellow'].includes(s.brush??'')).map(s=>({brush:s.brush!,orig:s.orig,dest:s.dest})))},turnColor:current.pos.turn,movable:{free:false,color:active&&!disabled?current.pos.turn:undefined,dests:active&&!disabled?chessgroundDests(current.pos):new Map(),events:{after:(from,to)=>{
   if(current.pos.board.get(parseSquare(from)!)?.role==='pawn'&&['1','8'].includes(to[1])){board.toPath(board.path,false);setPromotion({from,to});}
   else handlers.current.play(from+to);
  }}},draggable:{enabled:active&&!disabled},selectable:{enabled:active&&!disabled},premovable:{enabled:false}});
 },[active,disabled,pgn,pieceMode,options.stockfish,options.maia,display.arrows,display.maiaArrows,engines.stockfish,engines.maia]);
 const onReady=useCallback((board:Viewer|null)=>{viewer.current=board;setReady(!!board);},[]);
 const select=useCallback((value:string)=>viewer.current?.toPath(new Path(value),false),[]);
 useEffect(()=>{
  if(!active)return;
  const key=(event:KeyboardEvent)=>{
   if(pieceMode||promotion||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,dialog,[data-board-resize],[contenteditable=true]'))return;
   const actions:Record<string,'first'|'prev'|'next'|'last'>={Home:'first',End:'last',ArrowLeft:'prev',ArrowRight:'next'};
   if(actions[event.key]){event.preventDefault();viewer.current?.goTo(actions[event.key],false);}
   else if(event.key.toLowerCase()==='f'){event.preventDefault();viewer.current?.flip();}
  };
  document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
 },[active,promotion,pieceMode]);
 return <div className="study-review review-workspace" ref={resize.workspace}>
  <section className="review-board" ref={resize.board} aria-label="Personal study board">
   <div className="review-board-surface"><PgnBoard pgn={pgn} review ordinalPaths reviewPath={path} onReady={onReady} onPathChange={setPath} configureBoard={configureBoard}/><button {...resize.handle} data-board-resize className="board-resize-handle" title="Resize board"/></div>
   <div ref={resize.footer} className="study-actions">
    {(['first','prev','next','last'] as const).map((direction,i)=><button key={direction} aria-label={['Study first position','Study previous move','Study next move','Study last position'][i]} disabled={!ready} onClick={()=>viewer.current?.goTo(direction,false)}>{['|←','←','→','→|'][i]}</button>)}
    <button disabled={!ready} onClick={()=>viewer.current?.flip()}>Flip study board</button>
    <button disabled={!ready||disabled} onClick={()=>setPieceMode(true)}>Piece mode</button>
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
   {active&&pieceMode&&<PieceMode fen={position.fen} orientation={viewer.current?.orientation()??'white'} onReturn={()=>setPieceMode(false)}/>}
  </section>
  <section className="review-transcript" aria-label="Study moves"><ReviewMoves tokens={model.tokens} path={path} ready={ready} onSelect={select}/>
   <fieldset disabled={disabled}><legend>{path?'Selected position annotations':'Starting position notes'}</legend>
    <label>Position comment<textarea aria-label="Study position comment" maxLength={24000} value={notes.text} onChange={e=>{try{setComment(tree.current.tree,selectedId,e.target.value);commit(selectedId);setError('');}catch(error){setError(String(error));}}}/></label>
    <label>Numeric move glyphs (comma separated)<input aria-label="Study NAGs" key={selectedId+':'+notes.nags.join(',')} disabled={!path} defaultValue={notes.nags.join(',')} onBlur={e=>{try{setNags(tree.current.tree,selectedId,e.target.value.trim()?e.target.value.split(',').map(Number):[]);commit(selectedId);setError('');}catch(error){setError(String(error));}}}/></label>
    <div className="study-actions">{['!','?','!!','??','!?','?!'].map((glyph,index)=><button key={glyph} disabled={!path} aria-pressed={notes.nags.includes(index+1)} onClick={()=>{setNags(tree.current.tree,selectedId,notes.nags.includes(index+1)?notes.nags.filter(n=>n!==index+1):[...notes.nags,index+1]);commit(selectedId);}}>{glyph}</button>)}</div>
   </fieldset>
   <EnginePanel options={options} setOptions={setOptions} display={display} setDisplay={setDisplay} states={engines} position={position} onFlip={()=>viewer.current?.flip()} canFlip={ready} onPreview={moves=>{if(moves.slice(0,position.moves.length).every((m,i)=>m===position.moves[i]))setSuggestion({id:selectedId,moves:moves.slice(position.moves.length)});}}/>
   {suggestion?.id===selectedId&&suggestion.moves.length>0&&<div><p>Suggested continuation: {suggestion.moves.join(' ')}. Add it to this study?</p><button disabled={disabled} onClick={()=>{try{commit(addContinuation(tree.current.tree,selectedId,suggestion.moves));setSuggestion(null);}catch(e){setError(String(e));}}}>Add suggested continuation</button><button onClick={()=>setSuggestion(null)}>Cancel suggestion</button></div>}
  </section>
 </div>;
}

function Promotion({onPick,onCancel}:{onPick:(suffix:string)=>void;onCancel:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{dialog.current?.showModal();},[]);
 return <dialog ref={dialog} onCancel={onCancel} aria-label="Choose promotion"><p>Promote pawn to</p>{['q','r','b','n'].map((suffix,i)=><button key={suffix} autoFocus={i===0} onClick={()=>onPick(suffix)}>{['Queen','Rook','Bishop','Knight'][i]}</button>)}<button onClick={onCancel}>Cancel promotion</button></dialog>;
}
