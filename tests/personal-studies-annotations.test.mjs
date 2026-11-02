import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStudy, serializeStudy } from '../lib/personal-studies/pgn.mjs';
import { annotation, setComment, setNags } from '../lib/personal-studies/annotations.mjs';
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
