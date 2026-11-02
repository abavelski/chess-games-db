import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStudy, serializeStudy, semanticStudy, positions } from '../lib/personal-studies/pgn.mjs';
import { drawings } from '../lib/personal-studies/annotations.mjs';

const cases=[
 ['annotated chapter',readFileSync(new URL('./fixtures/personal-studies/annotated.pgn',import.meta.url),'utf8')],
 ['blank chapter','{Move zero [%cal Ge2e4] [%csl Yd4]} *'],
 ['promotion','1. a4 h5 2. a5 h4 3. a6 h3 4. axb7 hxg2 5. bxa8=N $1 *'],
 ['escaped headers','[Extra "Quote \\" and slash \\\\"]\n\n1. e4 {日本語} *'],
];
for(const [name,pgn] of cases)test('chapter interoperability: '+name,()=>{
 let tree=parseStudy(pgn);const expected=semanticStudy(tree),shapes=positions(tree).map(p=>drawings(tree,p.node.id));
 for(let i=0;i<3;i++){tree.changed=true;tree=parseStudy(serializeStudy(tree));assert.deepEqual(semanticStudy(tree),expected);assert.deepEqual(positions(tree).map(p=>drawings(tree,p.node.id)),shapes);}
});
