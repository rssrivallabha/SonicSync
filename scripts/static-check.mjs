import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('public/index.html');
const js = read('public/app.js');
const css = read('public/style.css');
const server = read('server.js');
const sw = read('public/sw.js');
const pkg = JSON.parse(read('package.json'));
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const refs = new Set([...js.matchAll(/\$\("#([^"\)]+)\)/g)].map(m => m[1]));
const missing = [...refs].filter(id => !ids.has(id));
const checks = [
 ['HTML/JS selectors', missing.length === 0, missing.join(', ')],
 ['hidden CSS', /\.hidden\s*\{[^}]*display:\s*none\s*!important/.test(css), 'missing .hidden rule'],
 ['v10.1 package/server version', pkg.version === '10.1.0' && /SonicSync v10\.1\.0 running/.test(server), 'stale package/server version'],
 ['upload commit ordering', /room\.track\s*=\s*track;[\s\S]*res\.json\(publicTrack\(track\)\)/.test(server), 'track commit race regression'],
 ['late-command compensation', /const lateMs = Math\.max\(0, nowS - startServer\)/.test(js), 'late schedule extrapolation missing'],
 ['adaptive sync lead', /function adaptiveLeadMs/.test(server) && /adaptiveLeadMs\(room, client/.test(server) && /function directLeadMs/.test(js), 'adaptive lead missing'],
 ['direct RTC signaling', /m\.type === "rtcSignal"/.test(server) && /RTCPeerConnection/.test(js) && /createDataChannel\("sync"/.test(js), 'direct P2P sync path missing'],
 ['direct clock lock', /clockPing/.test(js) && /clockPong/.test(js) && /hostClockLocked/.test(js) && /directClockUsable/.test(js), 'direct host clock model missing'],
 ['direct beacon timeline', /k: "beacon"/.test(js) && /hostOutputEpoch/.test(js) && /currentHostReferencePosition/.test(js), 'host output playhead beacon missing'],
 ['manual sync direct retry', /verify-retry/.test(js) && /rtcSend\(state\.rtc\.hostPeerId/.test(js), 'manual direct retry missing'],
 ['source generation guard', /state\.sourceGeneration/.test(js) && /state\.source !== src/.test(js), 'stale source guard missing'],
 ['pause position retained', /room\.pausePosition/.test(server) && /room\.position = room\.pausePosition/.test(server), 'pause persistence missing'],
 ['stop position retained', /room\.stopPosition/.test(server) && /room\.position = room\.stopPosition/.test(server), 'stop-hold persistence missing'],
 ['resume from retained position', /position: room\.position/.test(server) && /\["paused", "stopped"\]/.test(server), 'resume retained position missing'],
 ['stale sync canceled on transport state changes', /pauseScheduled/.test(js) && /state\.pendingAudioCommand = null/.test(js) && /stopLocalPlayback/.test(js) && /mediaScheduleTimer/.test(js), 'stale resync command can survive pause/stop'],
 ['explicit reset only reset-to-zero', /m\.type === "reset"/.test(server) && /resetLocal/.test(js), 'reset path missing'],
 ['iOS WebKit activation', /webkitAudioContext/.test(js) && /fromGesture/.test(js) && /primeActivationBuffer/.test(js) && /navigator\.audioSession/.test(js), 'iOS activation hardening missing'],
 ['iOS inline media fallback', /getMediaElement/.test(js) && /playsinline/.test(html) && /el\.play\(\)/.test(js), 'iOS media fallback missing'],
 ['MediaSession integration', /navigator\.mediaSession/.test(js) && /playbackState/.test(js), 'MediaSession support missing'],
 ['Range media serving', /Accept-Ranges/.test(server) && /Content-Range/.test(server) && /status\(206\)/.test(server), 'HTTP Range support missing'],
 ['host audio reference', /hostAudioBiasMs/.test(server) && /hostOutputEpoch/.test(js) && /contextTimeToLocalOutputEpoch/.test(js), 'host-output anchor missing'],
 ['command revisions', /room\.revision/.test(server) && /commandIsFresh/.test(js), 'revision guard missing'],
 ['service worker dynamic exclusion', /startsWith\('\/api\/'\)/.test(sw) && /startsWith\('\/media\/'\)/.test(sw), 'dynamic endpoints cached'],
 ['no legacy upload registration', !/m\.type === "track"/.test(server), 'legacy track message remains'],
 ['local/offline transport retained', /noInternetRequired: true/.test(server) && /state\.backendMode === "public" \? \[\{ urls: "stun:stun\.l\.google\.com:19302" \}\] : \[\]/.test(js), 'offline/local transport claim missing'],
 ['direct start handoff', /k:\s*"startAt"/.test(js) && /pendingStart/.test(js) && /contextTimeToLocalOutputEpoch/.test(js), 'direct host-output start handoff missing'],
 ['auto-sync throttle', /lastAutoSyncRequestAt/.test(js) && /1400/.test(js), 'auto drift can flood sync requests'],
 ['continuous phase PLL', /phase-lock\.mjs/.test(js) && /updatePhaseLock/.test(js) && /lastRateCorrectionPpm/.test(js), 'continuous phase controller missing'],
 ['bounded hard re-anchor threshold', /Math\.abs\(error\) > 80/.test(js) && /Math\.abs\(phaseError\) <= 80/.test(js), 'phase controller threshold is inconsistent'],
  ['audio gate not room barrier', /prepared < total \|\| clockLocked < total/.test(server) && !/prepared < total \|\| enabled < total/.test(server), 'participant audio gate still blocks host start'],['host UI start uses media+locked clock', /snapshot.ready.prepared >= snapshot.ready.total/.test(js) && /snapshot.ready.clockLocked >= snapshot.ready.total/.test(js) && /PLAY • ENABLE HOST AUDIO/.test(js), 'host UI does not use clock lock as readiness barrier'],['host UI resume uses locked clock', js.includes('snapshot.ready.clockLocked < snapshot.ready.total') && js.includes('snapshot.ready.total === 0'), 'host UI resume button does not require a locked clock'],

 ['sync retry attempt persistence', /attempts/.test(js) && /verify-retry/.test(js) && /const attempt = \+\+state\.pendingAudioCommand\.attempts/.test(js) && /attempt \}/.test(js), 'sync retry loop not bounded'],
 ['rtc timer cleanup', /clearInterval\(p\.statsTimer\)/.test(js) && /clearTimeout\(p\.reconnectTimer\)/.test(js), 'RTC timers can leak']
];
checks.push(
 ['timeline epoch invalidation', /timelineEpoch/.test(server) && /directCommandIsFresh/.test(js) && /timelineEpoch/.test(js), 'stale direct commands can survive state changes'],
 ['sync-all authoritative dispatch', /syncAllDispatch/.test(server) && /syncAllDispatch/.test(js) && /authoritative future anchor/.test(js), 'sync-all still double-sends direct/fallback commands'],
 ['soft phase lock', /function softPhaseLock/.test(js) && /PHASE CORRECTION/.test(js), 'small sync errors still force hard audio restarts'],
 ['pending start cancellation', /function clearPendingStart/.test(js) && /clearPendingStart\(\);/.test(js), 'queued starts can resurrect playback'],
 ['iOS silent WAV priming', /function makeSilentWavBlob/.test(js) && /primeMediaGesture/.test(js) && /compat-audio/.test(read('public/index.html')), 'iOS media element not gesture-primed'],
 ['iOS media priming before await', /if \(fromGesture\) \{ primeActivationBuffer\(ctx\); primeMediaGesture\(\); \}/.test(js), 'media element is primed after an async boundary']
);
checks.push(
 ['shared sync core modules', ['clock.mjs','timeline.mjs','state-machine.mjs','protocol.mjs','phase-lock.mjs'].every(f => fs.existsSync(path.join(root,'src/core',f))), 'shared core missing'],
 ['versioned wire envelope', /protocolVersion: TIMELINE_PROTOCOL_VERSION/.test(server) && /messageId/.test(server) && /timestamp: now\(\)/.test(server), 'server messages are not versioned'],
 ['incoming control validation', /validateControlMessage/.test(server) && /Invalid control packet/.test(server), 'incoming control packets are not validated'],
 ['content addressed media', /ContentAddressedMediaStore/.test(server) && /mediaStore\.putFile/.test(server) && /sha256/.test(server), 'media store not content-addressed'],
 ['queue controls', /m\.type === "next"/.test(server) && /m\.type === "previous"/.test(server) && /repeatMode/.test(server) && /queueIndex/.test(server), 'queue control path missing'],
 ['diagnostic export', /\/api\/room\/:room\/diagnostics/.test(server) && /text\/csv/.test(server) && /application\/json/.test(server), 'diagnostics export missing'],
 ['resume does not require every audio gate', /Resume locked:[^`]*Speaker audio gates may remain pending/.test(server), 'resume still requires all speaker audio gates'],
 ['resume timeline anchor retained', /startPosition/.test(server) && /room\.startedAt = room\.startAt - room\.position \* 1000/.test(server), 'resume still re-anchors from zero'],
 ['smoke covers audio gate and resume', /audioEnabled:false/.test(read('scripts/smoke-test.mjs')) && /Stop\/resume position did not advance/.test(read('scripts/smoke-test.mjs')), 'smoke coverage missing'],
 ['direct sync state guard', /m\.k==='syncRequest'&&isHost\(\)\)[\s\S]*if\(!roomStatePlaying\(\)\) return/.test(js) && /m\.k==='syncAt'&&!isHost\(\)\)[\s\S]*if\(!roomStatePlaying\(\)\) return/.test(js), 'direct sync can resurrect a paused/stopped node'],
 ['host disconnect safety', /hostGone/.test(js) && /stopLocalPlayback\(finite\(m\.position, currentLocalPosition\(\)\)\)/.test(js), 'speaker may continue locally after host loss']
);
checks.push(
  ['host can close local room safely', server.includes('app.delete("/api/room/:room"') && server.includes('type: "roomClosed"') && server.includes("removeRoom(room)"), 'local room close endpoint missing or unauthenticated']
);
checks.push(
  ['server shutdown clears maintenance loop', server.includes("const maintenanceTimer = setInterval(") && server.includes("clearInterval(maintenanceTimer)") && server.includes("const forceTimer = setTimeout("), 'SIGTERM can leave the Node server interval alive']
);
let failed = 0;
for (const [name, ok, detail] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${detail}`}`); if (!ok) failed++; }
if (failed) process.exit(1);
console.log(`\nAll ${checks.length} static checks passed.`);
