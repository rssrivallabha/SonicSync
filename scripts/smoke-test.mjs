import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';

const PORT = 8899;
const ROOT = process.cwd();
const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let logBuf = '';
proc.stdout.on('data', b => { logBuf += b.toString(); });
proc.stderr.on('data', b => { logBuf += b.toString(); });
const cleanup = () => { try { if (proc.exitCode === null) proc.kill('SIGTERM'); } catch {} };
let stage = "startup";
const watchdog = setTimeout(() => {
  console.error(`FAIL local smoke watchdog at stage: ${stage}\n${logBuf}`);
  cleanup();
  process.exit(1);
}, 45_000);
const fatal = error => {
  console.error(`FAIL local smoke at stage ${stage}: ${error?.stack || error}\n${logBuf}`);
  clearTimeout(watchdog);
  cleanup();
  setTimeout(() => process.exit(1), 150);
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('unhandledRejection', fatal);
process.on('uncaughtException', fatal);

async function waitHealth() {
  for (let i=0;i<60;i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) return; } catch {}
    await sleep(100);
  }
  throw new Error(`Server did not start.\n${logBuf}`);
}
function openNode(room, role, name, hostToken='') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const queue = [];
    const waiters = [];
    ws.on('message', data => {
      let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
      const idx = waiters.findIndex(w => !w.type || msg.type === w.type);
      if (idx >= 0) { const w = waiters.splice(idx, 1)[0]; w.resolve(msg); } else queue.push(msg);
    });
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ type:'join', room, role, name, hostToken })));
    function next(type, timeout=5000) {
      const idx = queue.findIndex(m => !type || m.type===type);
      if (idx >= 0) return Promise.resolve(queue.splice(idx,1)[0]);
      return new Promise((res,rej)=>{ const timer=setTimeout(()=>{const i=waiters.findIndex(w=>w.res===res); if(i>=0)waiters.splice(i,1); rej(new Error(`Timeout waiting for ${type}`));},timeout); waiters.push({type,res,resolve:res,reject:rej,timer}); });
    }
    next('welcome',5000).then(welcome => resolve({ws, next, welcome})).catch(reject);
  });
}
function send(ws, obj) { ws.send(JSON.stringify(obj)); }
async function waitSnapshot(node, predicate, timeout=7000) {
  const end=Date.now()+timeout;
  while(Date.now()<end){
    const left=end-Date.now();
    const m=await node.next('snapshot', Math.min(1000,left)).catch(()=>null);
    if(m?.snapshot && predicate(m.snapshot)) return m.snapshot;
  }
  throw new Error('Snapshot predicate timed out.');
}

stage = "health";
await waitHealth();
stage = "create room";
const roomInfo = await (await fetch(`http://127.0.0.1:${PORT}/api/room`, {method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
stage = 'open host websocket';
const host = await openNode(roomInfo.id,'host','Smoke Host',roomInfo.hostToken);
stage = 'open speaker websocket';
const client = await openNode(roomInfo.id,'client','Smoke Phone');
stage = 'open audio-gated websocket';
const gateClient = await openNode(roomInfo.id,'client','Gate Pending Phone');

const wav = await fs.readFile(path.join(ROOT,'test/fixtures/smoke.wav'));
const fd = new FormData(); fd.append('audio', new Blob([wav], {type:'audio/wav'}), 'smoke.wav');
stage = 'upload WAV';
const upload = await fetch(`http://127.0.0.1:${PORT}/api/upload`, {method:'POST',headers:{'X-SonicSync-Room':roomInfo.id,'X-SonicSync-Host':roomInfo.hostToken},body:fd});
if(!upload.ok) throw new Error(`Upload failed: ${await upload.text()}`);
const track = await upload.json();

send(host.ws,{type:'ready',trackId:track.id,audioReady:true,audioEnabled:true,clockLocked:true,clockSampleCount:10,bufferSec:3,outputLatencyMs:10,baseLatencyMs:5,durationSec:3});
send(client.ws,{type:'ready',trackId:track.id,audioReady:true,audioEnabled:true,clockLocked:true,clockSampleCount:10,bufferSec:3,outputLatencyMs:10,baseLatencyMs:5,durationSec:3});
send(gateClient.ws,{type:'ready',trackId:track.id,audioReady:true,audioEnabled:false,clockLocked:true,clockSampleCount:10,bufferSec:3,outputLatencyMs:10,baseLatencyMs:5,durationSec:3});
await waitSnapshot(gateClient,s=>s.ready.prepared===3 && s.ready.clockLocked===3 && s.ready.enabled===2);

stage = 'scheduled play';
send(host.ws,{type:'start',leadMs:1200});
await waitSnapshot(client,s=>s.state==='playing');
await sleep(550);
stage = 'pause';
send(host.ws,{type:'pause'});
const paused=await waitSnapshot(client,s=>s.state==='paused');
if(!(paused.position>0.2)) throw new Error(`Pause position did not advance: ${paused.position}`);
stage = 'resume after pause';
send(host.ws,{type:'resume',leadMs:1000});
await waitSnapshot(client,s=>s.state==='playing');
await sleep(450);
stage = 'stop hold';
send(host.ws,{type:'stop'});
const stopped=await waitSnapshot(client,s=>s.state==='stopped');
if(Math.abs(stopped.position-paused.position)<0.15) throw new Error('Stop/resume position did not advance after resume.');
send(host.ws,{type:'resume',leadMs:1000});
await waitSnapshot(client,s=>s.state==='playing');
stage = 'reset';
send(host.ws,{type:'reset'});
const reset=await waitSnapshot(client,s=>s.state==='ready' && Math.abs(s.position)<0.01);
if(reset.position!==0) throw new Error('Reset did not return to zero.');
stage = 'volume propagation';
send(host.ws,{type:'volume',volume:0.42});
const vol=await waitSnapshot(client,s=>Math.abs(s.volume-0.42)<0.001);
if(Math.abs(vol.volume-0.42)>0.001) throw new Error('Volume propagation failed.');

const range=await fetch(track.url ? `http://127.0.0.1:${PORT}${track.url}` : '', {headers:{Range:'bytes=0-9'}});
if(range.status!==206) throw new Error(`Range request failed: ${range.status}`);
const suffix=await fetch(`http://127.0.0.1:${PORT}${track.url}`, {headers:{Range:'bytes=-10'}});
if(suffix.status!==206) throw new Error(`Suffix range request failed: ${suffix.status}`);

stage = 'reject unauthenticated room close';
const badClose = await fetch(`http://127.0.0.1:${PORT}/api/room/${roomInfo.id}`, {
  method: 'DELETE', headers: { 'X-SonicSync-Host': '0'.repeat(64) }
});
if (badClose.status !== 403) throw new Error(`Unauthorised room close should return 403, got ${badClose.status}`);
stage = 'authenticated room close event';
const closedEvent = client.next('roomClosed', 5000);
const closeRoom = await fetch(`http://127.0.0.1:${PORT}/api/room/${roomInfo.id}`, {
  method: 'DELETE', headers: { 'X-SonicSync-Host': roomInfo.hostToken }
});
if (closeRoom.status !== 204) throw new Error(`Host close failed: ${closeRoom.status} ${await closeRoom.text()}`);
const closedMessage = await closedEvent;
if (closedMessage.type !== 'roomClosed') throw new Error('Room close event was not delivered to speakers.');

host.ws.close(); client.ws.close(); gateClient.ws.close(); cleanup();
clearTimeout(watchdog);
process.off('unhandledRejection', fatal); process.off('uncaughtException', fatal);
stage = 'complete';
console.log('SMOKE PASS • room join • upload • readiness • start • pause/resume position • stop-hold • reset • volume • HTTP ranges • authenticated room close');

