import { positionById } from './pgn.mjs';
const directive=/\[%[\w-]+(?:\s+[^\]]*)?\]/g;
function comments(tree,id){return id==='root'?tree.game:positionById(tree,id).node.data;}
function decode(comment){const match=/\[%cbtext ([A-Za-z0-9+/=]+)\]/.exec(comment);return match?new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(match[1]),c=>c.charCodeAt(0))):comment;}
function encode(prose){if(!/[{}]/.test(prose))return prose;const encoded=btoa(Array.from(new TextEncoder().encode(prose),b=>String.fromCharCode(b)).join(''));return prose.replaceAll('{','(').replaceAll('}',')')+' [%cbtext '+encoded+']';}
export function annotation(tree,id){
 const target=comments(tree,id),raw=target.comments??[];
 return {text:raw.map(decode).map(s=>s.includes('[%')?s.replace(directive,'').trim():s).filter(s=>s.length>0).join('\n\n'),nags:id==='root'?[]:target.nags??[]};
}
export function setComment(tree,id,value){
 if(typeof value!=='string'||value.length>24000||value.includes('\0'))throw Error('Comment must be text up to 24,000 characters.');
 if(/\[%/.test(value))throw Error('Edit PGN directives using drawing tools; prose cannot contain [% directives.');
 const encoded=value.length?encode(value):'';
 if(encoded.length>32000)throw Error('This comment is too large after lossless brace encoding. Shorten it before saving.');
 const target=comments(tree,id),directives=(target.comments??[]).flatMap(s=>s.match(directive)??[]).filter(s=>!s.startsWith('[%cbtext '));
 target.comments=[...(encoded?[encoded]:[]),...(directives.length?[directives.join(' ')]:[])];tree.changed=true;
}
export function setNags(tree,id,nags){
 if(id==='root'||!Array.isArray(nags)||nags.length>256||nags.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('Move annotations must be numeric NAGs 0–255.');
 comments(tree,id).nags=[...new Set(nags)];tree.changed=true;
}

const brushes={G:'green',R:'red',B:'blue',Y:'yellow'};
const letters=Object.fromEntries(Object.entries(brushes).map(([a,b])=>[b,a]));
export function drawings(tree,id){
 const result=[];
 for(const comment of comments(tree,id).comments??[])for(const match of comment.matchAll(/\[%(cal|csl)\s+([^\]]*)\]/g))for(const token of match[2].split(',')){
  const value=token.trim(),valid=match[1]==='cal'?/^([GRBY])([a-h][1-8])([a-h][1-8])$/.exec(value):/^([GRBY])([a-h][1-8])$/.exec(value);
  if(valid)result.push({brush:brushes[valid[1]],orig:valid[2],...(valid[3]?{dest:valid[3]}:{})});
 }
 return result;
}
export function setDrawings(tree,id,shapes){
 if(!Array.isArray(shapes)||shapes.length>256)throw Error('Maximum 256 drawings per position.');
 const arrows=[],squares=[];
 for(const shape of shapes){if(!letters[shape.brush]||! /^[a-h][1-8]$/.test(shape.orig)||shape.dest&&!/^[a-h][1-8]$/.test(shape.dest))throw Error('Invalid drawing color or square.');(shape.dest?arrows:squares).push(letters[shape.brush]+shape.orig+(shape.dest??''));}
 const target=comments(tree,id);
 target.comments=(target.comments??[]).map(s=>s.replace(/\[%(cal|csl)\s+([^\]]*)\]/g,(_all,kind,payload)=>{
  const unsupported=payload.split(',').map(s=>s.trim()).filter(s=>!(kind==='cal'?/^[GRBY][a-h][1-8][a-h][1-8]$/:/^[GRBY][a-h][1-8]$/).test(s));
  return unsupported.length?`[%${kind} ${unsupported.join(',')}]`:'';
 }).trim()).filter(Boolean);
 const directive=[arrows.length?'[%cal '+[...new Set(arrows)].sort().join(',')+']':'',squares.length?'[%csl '+[...new Set(squares)].sort().join(',')+']':''].filter(Boolean).join(' ');
 if(directive)target.comments.push(directive);tree.changed=true;
}
