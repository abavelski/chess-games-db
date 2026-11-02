import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStudy, serializeStudy } from '../lib/personal-studies/pgn.mjs';
import { annotation, setComment, setNags, drawings, setDrawings } from '../lib/personal-studies/annotations.mjs';
import { deleteMove } from '../lib/personal-studies/edits.mjs';
test('Unicode and literal braces, root notes, glyphs and unknown directives survive edits',()=>{
 let tree=parseStudy('{Root [%unknown root]} 1. e4 {Old [%cal Ge2e4] [%eval 0.3]} (1. d4 {Sibling} d5) e5 *');
 const e4=tree.game.moves.children[0].id,d4=tree.game.moves.children[1].id;
 setComment(tree,'root','Rød {idé} — 日本語');setComment(tree,e4,'Quotes " and backslash \\');setNags(tree,e4,[1,14,1,255]);
 assert.deepEqual(annotation(tree,e4).nags,[1,14,255]);assert.equal(annotation(tree,d4).text,'Sibling');
 deleteMove(tree,tree.game.moves.children[1].children[0].id);
 const output=serializeStudy(tree);assert.match(output,/%unknown root/);assert.match(output,/%cal Ge2e4/);assert.match(output,/%eval 0.3/);
 tree=parseStudy(output);assert.equal(annotation(tree,'root').text,'Rød {idé} — 日本語');assert.equal(annotation(tree,tree.game.moves.children[0].id).text,'Quotes " and backslash \\');
 assert.throws(()=>setNags(tree,'root',[1]));assert.throws(()=>setNags(tree,tree.game.moves.children[0].id,[256]));
});
test('four drawing colors at root and separate variations preserve prose and unknown directives',()=>{
 let tree=parseStudy('{Root [%unknown keep]} 1. e4 {Notes [%eval 0.3] [%cal Xunsupported]} (1. d4) *');
 const all=['green','red','blue','yellow'].flatMap(brush=>[{brush,orig:'e2',dest:'e4'},{brush,orig:'d4'}]);
 const e4=tree.game.moves.children[0].id,d4=tree.game.moves.children[1].id;
 setDrawings(tree,'root',all);setDrawings(tree,e4,all.slice(0,2));setDrawings(tree,d4,all.slice(2,4));
 assert.equal(drawings(tree,'root').length,8);assert.equal(drawings(tree,e4)[0].brush,'green');assert.equal(drawings(tree,d4)[0].brush,'red');
 tree=parseStudy(serializeStudy(tree));assert.equal(drawings(tree,'root').length,8);
 const node=tree.game.moves.children[0].id;setDrawings(tree,node,[]);
 assert.equal(annotation(tree,node).text,'Notes');assert.match(serializeStudy(tree),/%eval 0.3/);assert.match(serializeStudy(tree),/Xunsupported/);assert.equal(drawings(tree,node).length,0);
});
