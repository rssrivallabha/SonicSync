#!/usr/bin/env node
import fs from 'node:fs';
const file=process.argv[2]; if(!file){console.error('usage: node tools/measurement/analyze.mjs run.csv');process.exit(2)}
const rows=fs.readFileSync(file,'utf8').trim().split(/\r?\n/).filter(Boolean).map(line=>{const [k,v,...rest]=line.split(',');return {k,v,rest}});
const by=new Map(); for(const r of rows){const n=Number(r.v); if(Number.isFinite(n)){const a=by.get(r.k)||[];a.push(n);by.set(r.k,a)}}
const q=(a,p)=>a[Math.min(a.length-1,Math.max(0,Math.ceil(a.length*p)-1))];
const summary={generatedAt:new Date().toISOString(),metrics:{}};
for(const [key,arr] of by){arr.sort((a,b)=>a-b);summary.metrics[key]={n:arr.length,p50:q(arr,.5),p90:q(arr,.9),p95:q(arr,.95),p99:q(arr,.99),max:arr.at(-1),mean:arr.reduce((s,x)=>s+x,0)/arr.length}}
console.log(JSON.stringify(summary,null,2));
