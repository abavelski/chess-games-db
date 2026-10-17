import test from 'node:test';
import assert from 'node:assert/strict';
import {gameQuery} from '../electron/queries.mjs';
test('search and property values are bound, paging and sorts bounded',()=>{
 const payload="' OR 1=1 --";
 const q=gameQuery({search:payload,properties:{white:[payload]},page:-9,pageSize:500,sort:'DROP TABLE games'});
 assert.ok(!q.where.includes(payload));assert.equal(q.params.search,payload.toLowerCase());
 assert.equal(q.params.p_white,JSON.stringify([payload]));assert.equal(q.page,1);assert.equal(q.pageSize,40);
 assert.match(q.where,/g.hidden=0/);assert.match(q.orderBy,/ps.sequence/);
});
test('empty selections impose no constraint and properties combine with AND',()=>{
 assert.deepEqual(gameQuery({properties:{white:[]}}).params,{});
 const q=gameQuery({properties:{white:['2','1','2'],result:['draw','white_win']},yearFrom:'1980',yearTo:'2005',page:2,sort:'year_desc'});
 assert.equal(q.params.p_white,'["1","2"]');assert.equal(q.params.yearFrom,1980);assert.equal(q.params.yearTo,2005);assert.equal(q.offset,40);
 assert.throws(()=>gameQuery({properties:{invalid:[]}}),/Invalid/);
 assert.throws(()=>gameQuery({properties:{white:Array(101).fill('1')}}),/Invalid/);
});
