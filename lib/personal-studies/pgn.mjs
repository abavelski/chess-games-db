import { makePgn } from 'chessops/pgn';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { makeFen } from 'chessops/fen';
import { ordinalPathPart } from '../../src/pgn.mjs';
import { validatePgn } from './validation.mjs';

let nextIdentity=1;
export function parseStudy(source) {
 const game=validatePgn(source);
 const tree={game,source,changed:false};
 game.moves.id='root';
 const stack=[game.moves];
 while(stack.length){const node=stack.pop();for(const child of node.children){child.id='node-'+nextIdentity++;stack.push(child);}}
 return tree;
}
export function serializeStudy(tree) {
 if(!tree.changed)return tree.source;
 const pgn=makePgn(tree.game);validatePgn(pgn);return pgn;
}
export function positions(tree) {
 const entries=[],stack=[{node:tree.game.moves,path:'',parentId:null,pos:Chess.default()}];
 while(stack.length){
  const entry=stack.pop();entries.push({...entry,fen:makeFen(entry.pos.toSetup())});
  for(let i=entry.node.children.length-1;i>=0;i--){const child=entry.node.children[i],pos=entry.pos.clone();pos.play(parseSan(pos,child.data.san));stack.push({node:child,path:entry.path+ordinalPathPart(i),parentId:entry.node.id,pos});}
 }
 return entries;
}
export function positionById(tree,id) {const entry=positions(tree).find(e=>e.node.id===id);if(!entry)throw Error('Study position no longer exists.');return entry;}
export function identityAtPath(tree,path) {return positions(tree).find(e=>e.path===path)?.node.id??'root';}
export function pathForIdentity(tree,id) {return positionById(tree,id).path;}
export function semanticStudy(tree) {
 function content(node){return {data:node.data,children:node.children.map(content)};}
 return {headers:[...tree.game.headers].sort(([a],[b])=>a.localeCompare(b)),comments:tree.game.comments??[],moves:content(tree.game.moves)};
}
