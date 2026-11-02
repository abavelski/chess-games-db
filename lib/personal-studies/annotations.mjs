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
 const target=comments(tree,id),directives=(target.comments??[]).flatMap(s=>s.match(directive)??[]).filter(s=>!s.startsWith('[%cbtext '));
 target.comments=[...(value.length?[encode(value)]:[]),...(directives.length?[directives.join(' ')]:[])];tree.changed=true;
}
export function setNags(tree,id,nags){
 if(id==='root'||!Array.isArray(nags)||nags.length>256||nags.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('Move annotations must be numeric NAGs 0–255.');
 comments(tree,id).nags=[...new Set(nags)];tree.changed=true;
}
