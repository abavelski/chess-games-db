import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStudy, serializeStudy, semanticStudy, positions, identityAtPath, pathForIdentity } from '../lib/personal-studies/pgn.mjs';
const fixture=readFileSync(new URL('./fixtures/personal-studies/annotated.pgn',import.meta.url),'utf8');
test('strict one-game codec rejects unsupported input before saving',()=>{
 const cases=JSON.parse(readFileSync(new URL('./fixtures/personal-studies/cases.json',import.meta.url),'utf8'));
 for(const c of cases)if(c.valid)assert.doesNotThrow(()=>parseStudy(c.pgn),c.name);else assert.throws(()=>parseStudy(c.pgn),undefined,c.name);
 for(const pgn of ['1. e4 $999 *','1. e4 (1. d4 *','[Event "broken]\n*','1. e4 nonsense *','1. e4 ) *'])assert.throws(()=>parseStudy(pgn));
});
test('full tree, root comments, unknown annotations, six NAGs and duplicate siblings round trip',()=>{
 const tree=parseStudy(fixture);assert.equal(serializeStudy(tree),fixture);
 tree.changed=true;const normalized=serializeStudy(tree),reparsed=parseStudy(normalized);
 assert.deepEqual(semanticStudy(reparsed),semanticStudy(tree));
 assert.match(normalized,/CustomHeader/);assert.match(normalized,/%unknown preserve/);
 const siblings=positions(tree).filter(p=>p.node.data?.san==='c5');assert.equal(siblings.length,2);assert.notEqual(siblings[0].node.id,siblings[1].node.id);assert.notEqual(siblings[0].path,siblings[1].path);
 for(const p of positions(tree)){assert.equal(identityAtPath(tree,p.path),p.node.id);assert.equal(pathForIdentity(tree,p.node.id),p.path);}
});
