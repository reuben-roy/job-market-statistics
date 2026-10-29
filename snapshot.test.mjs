import test from 'node:test';
import assert from 'node:assert/strict';
import {filterSnapshot,monthlySeries,salarySummary,monthlySalary} from './snapshot.mjs';
const vocab={skills:[{id:'python',label:'Python'},{id:'sql',label:'SQL'}]};
const sample={vocabulary_version:'1',generated_at:'now',groups:[{role:'engineering',country:'US',industry:'unknown',status:'open',published_on:'2026-01-10',postings:2,with_skills:1,skills:{python:1}},{role:'data',country:'US',industry:'unknown',status:'closed',published_on:'2026-03-15',postings:3,with_skills:3,skills:{python:2,sql:3}},{role:'data',country:'unknown',industry:'unknown',status:'open',published_on:null,postings:1,with_skills:0,skills:{}}]};
for (const g of sample.groups) {g.classified=g.with_skills;g.salary={count:0,min_sum:0,max_sum:0};}
const all={role:'all',country:'all',industry:'all',status:'all',from:'',to:''};
test('includes closed and unknown dates unless filtered',()=>{let r=filterSnapshot(sample,vocab,all);assert.equal(r.denominator.postings,6);assert.equal(r.coverage.unknown_dates,1);assert.equal(filterSnapshot(sample,vocab,{...all,status:'closed'}).denominator.postings,3);});
test('date ranges are inclusive and exclude unknown dates',()=>{let r=filterSnapshot(sample,vocab,{...all,from:'2026-01-10',to:'2026-03-15'});assert.equal(r.denominator.postings,5);assert.equal(r.coverage.unknown_dates,0);assert.equal(filterSnapshot(sample,vocab,{...all,from:'2026-01-11',to:'2026-03-14'}).denominator.postings,0);});
test('monthly cohorts aggregate and fill gaps',()=>{let r=monthlySeries(matching(),['python','sql']);assert.deepEqual(r.map(x=>[x.month,x.values.python]),[['2026-01',1],['2026-02',0],['2026-03',2]]);});
function matching(){return filterSnapshot(sample,vocab,all).groups;}

test('salary averages weight postings rather than groups and ignore unknown dates in monthly view',()=>{const groups=[{published_on:'2026-01-01',salary:{count:2,min_sum:200000,max_sum:400000}},{published_on:'2026-01-02',salary:{count:1,min_sum:300000,max_sum:400000}},{published_on:null,salary:{count:1,min_sum:100000,max_sum:100000}}];assert.equal(salarySummary(groups).midpoint,187500);assert.equal(monthlySalary(groups)[0].midpoint,650000/3);});
