import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parseStudy, serializeStudy, positions } from '../lib/personal-studies/pgn.mjs';
import { reviewPgn } from '../src/pgn.mjs';

export function longStudyPgn(){let score='';for(let n=1;n<=256;n++)score+=`${n}. ${n%2?'Nf3 Nf6':'Ng1 Ng8'} `;return score+'*';}
test('512-ply study codec and score stay bounded and responsive',t=>{
 const start=performance.now(),tree=parseStudy(longStudyPgn());tree.changed=true;
 const output=serializeStudy(tree),review=reviewPgn(output,true);
 assert.equal(positions(tree).length,513);assert.equal(review.tokens.filter(t=>t.type==='move').length,512);
 const elapsed=performance.now()-start;t.diagnostic(`512-ply parse, serialize and review: ${elapsed.toFixed(1)} ms`);
 assert.ok(elapsed<5000,'512-ply codec/review regression budget');
});
