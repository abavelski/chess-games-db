import { ChildNode } from 'chessops/pgn';
import { parseSan, makeSan } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { positionById, positions } from './pgn.mjs';
let next=1;
export function addMove(tree,id,input) {
 const {node,pos,path}=positionById(tree,id);
 const move=/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(input)?parseUci(input):parseSan(pos,input);
 if(!move||!pos.isLegal(move))throw Error('That move or promotion is not legal here.');
 const san=makeSan(pos,move),existing=node.children.find(child=>child.data.san===san);
 if(existing)return existing.id;
 if(path.length/2>=1024||positions(tree).length>=10001)throw Error('Study move limit reached.');
 const child=new ChildNode({san});child.id='edit-'+next++;node.children.push(child);tree.changed=true;return child.id;
}
export function deleteMove(tree,id) {
 if(id==='root')throw Error('The starting position cannot be deleted.');
 const {parentId}=positionById(tree,id),parent=positionById(tree,parentId).node;
 parent.children=parent.children.filter(child=>child.id!==id);tree.changed=true;return parentId;
}
