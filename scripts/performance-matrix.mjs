import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const cases=[
  {nodes:8, latency:20, jitter:3, drift:40, loss:0.001, duration:30},
  {nodes:16, latency:50, jitter:10, drift:80, loss:0.01, duration:60},
  {nodes:32, latency:80, jitter:25, drift:120, loss:0.03, duration:60},
  {nodes:32, latency:100, jitter:35, drift:150, loss:0.05, duration:60},
  {nodes:16, latency:150, jitter:50, drift:200, loss:0.08, duration:60},
];
const rows=cases.map(c=>{
  const args=[]; for(const [k,v] of Object.entries(c)) args.push(`--${k}`,String(v));
  return { ...c, result: JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/sync-sim.mjs'),...args],{encoding:'utf8'})) };
});
const out={generatedAt:new Date().toISOString(), note:'Software simulation only; not an acoustic or 50 m physical measurement.',cases:rows};
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
fs.writeFileSync(path.join(root,'artifacts/performance-matrix.json'),JSON.stringify(out,null,2));
for(const x of rows) console.log(`${x.nodes} nodes / ${x.latency}ms / ${x.loss*100}% loss → max ${x.result.softwarePhaseErrorMs.max.toFixed(2)} ms, p95 ${x.result.softwarePhaseErrorMs.p95.toFixed(2)} ms`);
