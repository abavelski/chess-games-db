import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStudy, serializeStudy, positionById, positions } from '../lib/personal-studies/pgn.mjs';
import { addMove, deleteMove, addContinuation } from '../lib/personal-studies/edits.mjs';
test('legal edits select continuations, retain duplicate siblings, branch from root and delete only selected subtree',()=>{
 const tree=parseStudy('1. e4 e5 (1... c5 2. Nf3 (2. Nc3 Nc6)) (1... c5 2. c3) *');
 const e4=tree.game.moves.children[0].id;
 const original=serializeStudy(tree);assert.throws(()=>addMove(tree,e4,'e2e5'),/legal/);assert.equal(serializeStudy(tree),original);
 const firstC5=addMove(tree,e4,'c5');assert.equal(positionById(tree,e4).node.children.length,3);
 const nf3=addMove(tree,firstC5,'Nf3'),d6=addMove(tree,nf3,'d6');assert.equal(positionById(tree,d6).node.data.san,'d6');
 const rootBranch=addMove(tree,'root','d2d4');assert.equal(positionById(tree,rootBranch).node.data.san,'d4');
 assert.equal(deleteMove(tree,firstC5),e4);assert.equal(positionById(tree,e4).node.children.length,2);assert.equal(positionById(tree,e4).node.children[1].data.san,'c5');
 assert.throws(()=>positionById(tree,nf3));assert.throws(()=>deleteMove(tree,'root'));
 assert.doesNotThrow(()=>parseStudy(serializeStudy(tree)));
});
test('explicit continuation validates the whole line before adding any node',()=>{
 const tree=parseStudy('*'),before=serializeStudy(tree);
 assert.throws(()=>addContinuation(tree,'root',['e2e4','e7e4']));assert.equal(serializeStudy(tree),before);
 const last=addContinuation(tree,'root',['e2e4','e7e5','g1f3']);assert.equal(positionById(tree,last).node.data.san,'Nf3');
});
test('standard-root promotion accepts explicit underpromotion and rejects invalid suffix',()=>{
 const tree=parseStudy('1. a4 h5 2. a5 h4 3. a6 h3 4. axb7 hxg2 *');
 const last=positions(tree).at(-1).node.id,original=serializeStudy(tree);
 assert.throws(()=>addMove(tree,last,'b7a8k'));assert.equal(serializeStudy(tree),original);
 const promoted=addMove(tree,last,'b7a8n');assert.equal(positionById(tree,promoted).node.data.san,'bxa8=N');
 assert.doesNotThrow(()=>parseStudy(serializeStudy(tree)));
});
