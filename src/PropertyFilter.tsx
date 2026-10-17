import { useEffect, useId, useRef, useState } from 'react';
import type { PropertyKey, PropertyOption, SearchFilters } from './types';
export function PropertyFilter({property,label,selected,filters,onChange}: {
 property: PropertyKey; label: string; selected: string[]; filters: SearchFilters; onChange: (values:string[])=>void;
}) {
 const id=useId(),[open,setOpen]=useState(false),[query,setQuery]=useState(''),[options,setOptions]=useState<PropertyOption[]>([]);
 const [cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[active,setActive]=useState(0);
 const labels=useRef(new Map<string,string>()),request=useRef(0),root=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null);
 const filterKey=JSON.stringify(filters);
 useEffect(()=>{
  if(!open)return;
  let alive=true;const sequence=++request.current;
  setLoading(true);setError('');
  const timer=setTimeout(()=>{
   window.chessArchive.propertyOptions({property,query,filters:JSON.parse(filterKey)}).then(result=>{
    if(!alive||sequence!==request.current)return;
    for(const option of result.options)labels.current.set(option.id,option.label);
    setOptions(result.options);setCursor(result.cursor);setActive(0);
   }).catch(cause=>{if(alive)setError(String(cause.message??cause));}).finally(()=>{if(alive)setLoading(false);});
  },200);
  return()=>{alive=false;clearTimeout(timer);};
 },[open,query,filterKey,property]);
 useEffect(()=>{
  const close=(event:MouseEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
  document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);
 },[]);
 useEffect(()=>{if(open)document.getElementById(id+'-'+active)?.scrollIntoView({block:'nearest'});},[open,id,active]);
 const toggle=(value:string)=>onChange(selected.includes(value)?selected.filter(v=>v!==value):[...selected,value]);
 const loadMore=async()=>{
  if(!cursor||loading)return;
  const sequence=request.current;setLoading(true);
  try {
   const result=await window.chessArchive.propertyOptions({property,query,filters,cursor});
   if(sequence!==request.current)return;
   for(const option of result.options)labels.current.set(option.id,option.label);
   setOptions(old=>[...old,...result.options.filter(o=>!old.some(p=>p.id===o.id))]);setCursor(result.cursor);
  }catch(cause){setError(String(cause));}finally{if(sequence===request.current)setLoading(false);}
 };
 return <div className="property-filter" ref={root}>
  <span id={id+'-label'}>{label}</span>
  <button className="property-trigger" aria-labelledby={id+'-label'} aria-expanded={open} aria-controls={id} onClick={()=>{setOpen(!open);requestAnimationFrame(()=>input.current?.focus());}}>{selected.length?`${selected.length} selected`:'Any'}</button>
  {selected.length>0&&<div className="property-chips">{selected.map(value=><button key={value} aria-label={`Remove ${labels.current.get(value)??value} from ${label}`} onClick={()=>toggle(value)}>{labels.current.get(value)??value} ×</button>)}</div>}
  {open&&<div className="property-popover">
   <input ref={input} role="combobox" aria-label={`Search ${label}`} aria-expanded={open} aria-controls={id} aria-autocomplete="list" aria-activedescendant={options[active]?id+'-'+active:undefined}
    value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{
     if(event.key==='ArrowDown'){event.preventDefault();setActive(i=>Math.min(i+1,options.length-1));}
     if(event.key==='ArrowUp'){event.preventDefault();setActive(i=>Math.max(0,i-1));}
     if(event.key==='Enter'&&options[active]){event.preventDefault();toggle(options[active].id);}
     if(event.key==='Escape'){setOpen(false);root.current?.querySelector<HTMLButtonElement>('.property-trigger')?.focus();}
    }}/>
   {error&&<p role="alert">{error}</p>}
   <div id={id} role="listbox" aria-labelledby={id+'-label'} aria-multiselectable="true">
    {options.map((option,index)=><button role="option" id={id+'-'+index} key={option.id} aria-selected={selected.includes(option.id)} className={active===index?'active':''} onMouseEnter={()=>setActive(index)} onClick={()=>toggle(option.id)}>
     <span>{selected.includes(option.id)?'✓ ':''}{option.label}</span><small>{option.count}</small>
    </button>)}
   </div>
   {loading&&<p role="status">Loading…</p>}
   {!loading&&!error&&!options.length&&<p>No options found</p>}
   {cursor&&<button disabled={loading} onClick={()=>void loadMore()}>More options</button>}
  </div>}
 </div>;
}
