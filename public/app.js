const $ = (s) => document.querySelector(s);

let coreEstimateClock = null;
let corePhaseLock = null;
import("/core/clock.mjs").then(m => { coreEstimateClock = m.estimateClock; }).catch(() => {});
import("/core/phase-lock.mjs").then(m => { corePhaseLock = m; }).catch(() => {});

const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const AC = window.AudioContext || window.webkitAudioContext;

const state = {
  ws: null,
  room: null,
  role: null,
  clientId: null,
  hostToken: null,
  snapshot: null,
  revision: 0,
  enabled: false,
  audioCtx: null,
  audioBuffer: null,
  audioEngine: AC ? "webaudio" : "media",
  mediaEl: null,
  mediaNode: null,
  source: null,
  sourceGeneration: 0,
  gainNode: null,
  playing: false,
  scheduledStartServer: null,
  audioStartCtx: null,
  sourceStartPosition: 0,
  playbackPosition: 0,
  playbackPositionCtx: 0,
  positionAtPause: 0,
  pendingAudioCommand: null,
  scheduledTimer: null,
  mediaScheduleTimer: null,
  driftTimer: null,
  driftController: { filteredErrorMs: 0, integralMsSec: 0, initialized: false, correctionPpm: 0 },
  syncTimer: null,
  telemetryTimer: null,
  wakeLock: null,
  rtc: {
    peers: new Map(),
    hostPeerId: null,
    hostClock: { samples: [], offsetMs: 0, driftPpm: 0, anchorLocalMs: 0, anchorOffsetMs: 0, jitterMs: 0 },
    hostClockLocked: false,
    hostBeacon: null,
    hostRttMs: 0,
    hostJitterMs: 0,
    pingSeq: 0,
    pingTimer: null,
    available: false,
    pendingStart: null,
    lastDirectSyncCommandId: null
  },
  volume: 1,
  muted: false,
  trimMs: clamp(Number(localStorage.getItem("sonicsync.trimMs") || 0), -500, 500),
  deviceName: localStorage.getItem("sonicsync.deviceName") || "",
  trackLoadKey: null,
  trackLoadPromise: null,
  audioReady: false,
  audioEnabled: false,
  lastError: "",
  lastSyncErrorMs: 0,
  clock: { samples: [], offsetMs: 0, driftPpm: 0, anchorLocalMs: 0, anchorOffsetMs: 0, jitterMs: 0 },
  clockLocked: false,
  clockUncertaintyMs: 0,
  syncConfidence: 0,
  rttMs: 0,
  outputLatencyMs: 0,
  baseLatencyMs: 0,
  logLines: [],
  reconnectTimer: null,
  reconnectAttempt: 0,
  lastAutoSyncRequestAt: 0,
  lastRateCorrectionPpm: 0,
  intentionallyClosed: false,
  _seekDrag: false
};

function finite(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function fmt(sec) { sec = Math.max(0, Number(sec) || 0); const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; }
function signMs(v) { return `${v >= 0 ? "+" : ""}${finite(v).toFixed(1)} ms`; }
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); }
function isHost() { return state.role === "host"; }
function localNowMs() { return performance.timeOrigin + performance.now(); }
function serverFromLocal(local) {
  const c = state.clock;
  if (!c.anchorLocalMs) return local + c.offsetMs;
  return local + c.anchorOffsetMs + (local - c.anchorLocalMs) * (c.driftPpm / 1e6);
}
function serverNow() { return serverFromLocal(localNowMs()); }
function localFromServerEpoch(serverEpoch) {
  const c = state.clock;
  if (!c.anchorLocalMs) return finite(serverEpoch) - c.offsetMs;
  const ratio = 1 + c.driftPpm / 1e6;
  if (Math.abs(ratio) < 0.5) return finite(serverEpoch) - c.anchorOffsetMs;
  return c.anchorLocalMs + (finite(serverEpoch) - (c.anchorLocalMs + c.anchorOffsetMs)) / ratio;
}
function wsUrl(room) { const u = new URL(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`); if (room) u.searchParams.set("room", String(room).toUpperCase()); return u.toString(); }
function log(message) { state.logLines.unshift(`[${new Date().toLocaleTimeString()}] ${message}`); state.logLines = state.logLines.slice(0, 14); if ($("#log")) $("#log").textContent = state.logLines.join("\n"); }
function roomStatePlaying() { return state.snapshot && ["playing", "pausing", "stopping"].includes(state.snapshot.state) && state.snapshot.startedAt != null; }
function send(message) { if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(message)); }
function rtcSend(peerId, message, channel = "control") {
  const peer = state.rtc.peers.get(peerId); const dc = peer?.channels?.[channel];
  if (!dc || dc.readyState !== "open") return false;
  try { dc.send(JSON.stringify(message)); return true; } catch { return false; }
}
function rtcBroadcast(message, channel = "control") {
  let sent = 0; for (const [peerId] of state.rtc.peers) if (rtcSend(peerId, message, channel)) sent++; return sent;
}
async function api(url, options = {}) { const r = await fetch(url, options); const text = await r.text(); if (!r.ok) throw new Error(text || `HTTP ${r.status}`); return text ? JSON.parse(text) : {}; }
function deviceName() { if (state.deviceName) return state.deviceName; return (IS_IOS || /Android/i.test(navigator.userAgent) ? "Phone" : "Device") + " " + Math.random().toString(36).slice(2, 5).toUpperCase(); }
function cryptoRandomId() { try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; } }

function commandIsFresh(m) {
  const rev = finite(m?.revision, state.revision);
  if (rev && rev < state.revision) return false;
  if (rev) state.revision = Math.max(state.revision, rev);
  const epoch = Number.isFinite(Number(m?.timelineEpoch)) ? Number(m.timelineEpoch) : null;
  if (epoch != null && epoch < state.timelineEpoch) return false;
  if (epoch != null) state.timelineEpoch = Math.max(state.timelineEpoch, epoch);
  return true;
}
function directCommandIsFresh(m) {
  const epoch = Number.isFinite(Number(m?.timelineEpoch)) ? Number(m.timelineEpoch) : null;
  return epoch == null || epoch >= state.timelineEpoch;
}
function clearPendingStart() {
  if (state.rtc.pendingStart?.timer) clearTimeout(state.rtc.pendingStart.timer);
  state.rtc.pendingStart = null;
}

async function createRoom() {
  try {
    const payload = await api("/api/room", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    localStorage.setItem("sonicsync.hostToken", payload.hostToken);
    location.href = `/?room=${payload.id}&host=1`;
  } catch (e) { alert(e.message); }
}
function initApp(host) {
  $("#landing")?.classList.add("hidden");
  $("#joinPanel")?.classList.add("hidden");
  $("#app")?.classList.remove("hidden");
  $("#hostControls")?.classList.toggle("hidden", !host);
  $("#speakerPanel")?.classList.toggle("hidden", host);
  if (!host && IS_IOS) $("#joinHelp").textContent = "On iPhone/iPad, tap Join & Activate Speaker once. iOS requires a user gesture before audible Web Audio can start.";
}

async function joinAsClient() {
  const room = $("#joinCode").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(room)) return alert("Enter the 6-character room code.");
  const name = ($("#deviceName").value.trim() || deviceName()).slice(0, 32);
  state.deviceName = name; localStorage.setItem("sonicsync.deviceName", name);
  initApp(false);
  // IMPORTANT: acquire the audio user gesture before network/async work. This is critical on iOS/WebKit.
  try {
    await unlockAudio({ resume: true, testTone: true, fromGesture: true });
    log("SPEAKER OUTPUT ENABLED • joining local room automatically.");
  } catch {
    showEnableAudio();
    log("Joined with audio locked • tap ENABLE SPEAKER AUDIO once to unlock playback.");
  }
  connect(room, "client", name, null);
}

$("#createRoomBtn")?.addEventListener("click", createRoom);
$("#heroCreate")?.addEventListener("click", createRoom);
$("#heroJoin")?.addEventListener("click", () => { $("#landing").classList.add("hidden"); $("#joinPanel").classList.remove("hidden"); $("#joinCode").focus(); });
$("#backBtn")?.addEventListener("click", () => { $("#joinPanel").classList.add("hidden"); $("#landing").classList.remove("hidden"); });
$("#joinCode")?.addEventListener("input", e => { e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6); });
$("#joinBtn")?.addEventListener("pointerdown", () => { if (!state.audioEnabled) unlockAudio({ resume: true, fromGesture: true }).catch(()=>{}); }, { passive: true });
$("#joinBtn")?.addEventListener("click", joinAsClient);
$("#deviceName") && ($("#deviceName").value = state.deviceName);

function boot() {
  const p = new URLSearchParams(location.search), room = p.get("room"), wantsHost = p.get("host") === "1";
  if (room && wantsHost) {
    initApp(true);
    state.hostToken = localStorage.getItem("sonicsync.hostToken");
    connect(room.toUpperCase(), "host", "HOST", state.hostToken);
    return;
  }
  if (room) {
    $("#landing").classList.add("hidden"); $("#joinPanel").classList.remove("hidden"); $("#joinCode").value = room.toUpperCase();
    $("#joinBtn").textContent = IS_IOS ? "JOIN & ACTIVATE SPEAKER →" : "JOIN ROOM →";
  }
}

function connect(room, role, name, hostToken) {
  clearTimeout(state.reconnectTimer);
  state.room = room.toUpperCase(); state.role = role; state.hostToken = hostToken; state.intentionallyClosed = false;
  state.clock = { samples: [], offsetMs: 0, driftPpm: 0, anchorLocalMs: 0, anchorOffsetMs: 0, jitterMs: 0 };
  state.clockLocked = false; state.clockUncertaintyMs = 0; state.syncConfidence = 0;
  $("#roomCode").textContent = state.room; $("#connectionBadge").textContent = "CONNECTING"; $("#connectionBadge").className = "badge bad";
  const ws = new WebSocket(wsUrl(room)); state.ws = ws;
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    state.reconnectAttempt = 0;
    $("#connectionBadge").textContent = "CONNECTED"; $("#connectionBadge").className = "badge good";
    send({ type: "join", room: state.room, role, name, hostToken });
    initRTCForRole();
    startClockSync(); startTelemetryLoop();
    log(`CONTROL LINK • ${role.toUpperCase()} • local LAN`);
  };
  ws.onclose = () => {
    $("#connectionBadge").textContent = "RECONNECTING"; $("#connectionBadge").className = "badge warn";
    clearInterval(state.syncTimer); clearInterval(state.telemetryTimer);
    if (state.intentionallyClosed) return;
    const delay = Math.min(7000, 400 * (2 ** state.reconnectAttempt++));
    log(`CONTROL LINK CLOSED • reconnecting in ${delay}ms.`);
    state.reconnectTimer = setTimeout(() => connect(state.room, state.role, name, state.hostToken), delay);
  };
  ws.onerror = () => log("CONTROL LINK ERROR • waiting for reconnect or retry.");
  ws.onmessage = e => { try { handle(JSON.parse(e.data)); } catch (err) { log(`PACKET ERROR • ${err.message}`); } };
}

function handle(m) {
  if (m.type === "error") { log(`ERROR • ${m.message}`); alert(m.message); return; }
  if (m.type === "syncReply") { finishClockSync(m); return; }
  if (m.type === "welcome") {
    state.clientId = m.clientId; state.role = m.role; state.revision = finite(m.revision, 0); state.timelineEpoch = finite(m.snapshot?.timelineEpoch, 0); state.snapshot = m.snapshot; render(m.snapshot);
    if (m.snapshot.track) prepareTrack(m.snapshot.track);
    if (!isHost()) log("NODE ONLINE • automatic track preload + timeline following enabled.");
    return;
  }
  if (m.type === "snapshot") { if (!commandIsFresh(m)) return; state.snapshot = m.snapshot; state.revision = Math.max(state.revision, finite(m.revision, 0)); render(m.snapshot); return; }
  if (m.type === "rtcPeerJoin") { startHostPeer(m.peerId, m.name); return; }
  if (m.type === "rtcHostAvailable") { state.rtc.hostPeerId = m.hostId; ensureClientHostPeer(m.hostId); return; }
  if (m.type === "rtcPeerLeft") { closeRTCPeer(m.peerId); return; }
  if (m.type === "rtcSignal") { handleRTCSignal(m.fromClientId, m.payload); return; }
  if (m.revision && !commandIsFresh(m)) return;
  if (m.type === "queueUpdated") { render(state.snapshot); return; }
  if (m.type === "queueEnd") { log("QUEUE • reached the end."); return; }
  if (m.type === "trackOffer") { state.snapshot = state.snapshot || { track: null, devices: [], ready: { total: 0, ready: 0 }, state: "idle", volume: 1, muted: false, timelineEpoch: state.timelineEpoch }; state.snapshot.track = m.track; state.revision = Math.max(state.revision, finite(m.revision, 0)); state.timelineEpoch = Math.max(state.timelineEpoch, finite(m.timelineEpoch, state.timelineEpoch)); state.snapshot.timelineEpoch = state.timelineEpoch; render(state.snapshot); prepareTrack(m.track); return; }
  if (m.type === "schedule") { scheduleStart(m.effectiveAt ?? m.startAt, finite(m.position, 0), m.reason || "room-start", m.commandId, m.timelineEpoch); return; }
  if (m.type === "playing") { state.playing = true; return; }
  if (m.type === "syncNow") { scheduleResync(m.effectiveAt, finite(m.position, 0), m.reason || "sync", m.commandId, m.timelineEpoch); return; }
  if (m.type === "syncAllDispatch") {
    if (!isHost() || !commandIsFresh(m)) return;
    const hostAt = localFromServerEpoch(finite(m.effectiveAt, serverNow()));
    let sent = 0;
    for (const [peerId, peer] of state.rtc.peers) {
      if (peer.channels.control?.readyState === "open" && sendDirectSyncCommand(peerId, hostAt, finite(m.position, 0), m.commandId, 0, m.timelineEpoch)) sent++;
    }
    log(`SYNC ALL • authoritative anchor • ${sent} direct P2P nodes + LAN fallback.`);
    return;
  }
  if (m.type === "syncHostKeep") { return; }
  if (m.type === "pauseScheduled") { clearPendingStart(); state.pendingAudioCommand = null; clearTimeout(state.scheduledTimer); schedulePause(m.effectiveAt, finite(m.position, 0)); return; }
  if (m.type === "stopScheduled") { clearPendingStart(); state.pendingAudioCommand = null; clearTimeout(state.scheduledTimer); scheduleStop(m.effectiveAt, finite(m.position, 0)); return; }
  if (m.type === "paused") { commitRoomStop(m.position, "paused"); return; }
  if (m.type === "stopped") { commitRoomStop(m.position, "stopped"); return; }
  if (m.type === "position") { commitRoomStop(m.position, m.state || "stopped"); return; }
  if (m.type === "reset") { clearPendingStart(); resetLocal(); return; }
  if (m.type === "seekLive") { clearPendingStart(); scheduleFadeResync(m.effectiveAt, finite(m.position, 0), "host-seek"); return; }
  if (m.type === "seekCommit") { if (state.snapshot) { state.snapshot.position = finite(m.position, 0); state.snapshot.startedAt = m.startedAt; } return; }
  if (m.type === "seek") { seekLocal(finite(m.position, 0)); return; }
  if (m.type === "volume") { applyRoomOutput(m.volume, false); return; }
  if (m.type === "mute") { applyRoomOutput(m.volume, Boolean(m.muted)); return; }
  if (m.type === "trim") { state.trimMs = clamp(finite(m.trimMs), -500, 500); localStorage.setItem("sonicsync.trimMs", String(state.trimMs)); updateTrimLabel(); return; }
  if (m.type === "roomLock") { log(`ROOM ${m.locked ? "LOCKED" : "UNLOCKED"}`); return; }
  if (m.type === "kicked") { alert("The host removed this device from the room."); location.href = "/"; return; }
  if (m.type === "hostGone") {
    if (!isHost()) { clearPendingStart(); stopLocalPlayback(finite(m.position, currentLocalPosition())); if (state.rtc.hostPeerId) closeRTCPeer(state.rtc.hostPeerId); }
    log("HOST DISCONNECTED • playback halted safely; reconnect host to continue."); return;
  }
  if (m.type === "syncIdle") { log("SYNC • room is not currently playing."); return; }
  if (m.type === "readyAck") { return; }
}


function rtcConfig() {
  // Local-only ICE: no STUN/TURN dependency. WebRTC should select LAN/private candidates.
  return { iceServers: [], iceCandidatePoolSize: 4, bundlePolicy: "max-bundle", rtcpMuxPolicy: "require" };
}
function sendRtcSignal(targetClientId, payload) { send({ type: "rtcSignal", targetClientId, payload }); }
function rtcStatus(peerId, stateValue) { send({ type: "rtcState", peerId, state: stateValue }); }
function closeRTCPeer(peerId) {
  const p = state.rtc.peers.get(peerId); if (!p) return;
  try { p.pc.close(); } catch {}
  clearInterval(p.beaconTimer); clearInterval(p.pingTimer); clearInterval(p.statsTimer); clearTimeout(p.reconnectTimer);
  state.rtc.peers.delete(peerId);
  if (state.rtc.hostPeerId === peerId) {
    state.rtc.hostPeerId = null; state.rtc.hostClock.samples = []; state.rtc.hostClockLocked = false; state.rtc.hostBeacon = null; state.rtc.available = false;
  }
  render(state.snapshot);
}
function createRTCPeer(peerId, initiator) {
  if (!window.RTCPeerConnection) return null;
  const existing = state.rtc.peers.get(peerId); if (existing) return existing;
  const pc = new RTCPeerConnection(rtcConfig());
  const peer = { id: peerId, pc, channels: {}, rttMs: 0, jitterMs: 0, pendingCandidates: [], beaconTimer: null, pingTimer: null, statsTimer: null, reconnectTimer: null, name: "Speaker" };
  state.rtc.peers.set(peerId, peer);
  pc.onicecandidate = e => { if (e.candidate) sendRtcSignal(peerId, { type: "candidate", candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState || pc.iceConnectionState || "new";
    rtcStatus(peerId, s); render(state.snapshot);
    if (["failed", "closed", "disconnected"].includes(s)) {
      clearTimeout(peer.reconnectTimer);
      const retryMs = s === "disconnected" ? 1800 : 900;
      peer.reconnectTimer = setTimeout(() => {
        if (state.rtc.peers.get(peerId) !== peer || pc.connectionState === "connected") return;
        const name = peer.name; closeRTCPeer(peerId);
        if (isHost()) startHostPeer(peerId, name); else ensureClientHostPeer(peerId);
      }, retryMs);
    } else if (s === "connected") {
      clearTimeout(peer.reconnectTimer); peer.reconnectTimer = null;
    }
  };
  pc.oniceconnectionstatechange = () => render(state.snapshot);
  if (initiator) {
    bindRTCChannel(peer, pc.createDataChannel("control", { ordered: true }), "control");
    bindRTCChannel(peer, pc.createDataChannel("sync", { ordered: false, maxRetransmits: 0 }), "sync");
    pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => sendRtcSignal(peerId, { type: "offer", description: pc.localDescription })).catch(e => log(`RTC OFFER FAILED • ${e.message}`));
  } else {
    pc.ondatachannel = e => bindRTCChannel(peer, e.channel, e.channel.label === "sync" ? "sync" : "control");
  }
  return peer;
}
function bindRTCChannel(peer, dc, label) {
  peer.channels[label] = dc;
  dc.onopen = () => {
    rtcStatus(peer.id, "connected"); state.rtc.available = true; startRTCStats(peer); render(state.snapshot);
    if (isHost()) startHostPeerProtocol(peer); else startClientHostProtocol(peer);
    log(`DIRECT P2P • ${peer.id.slice(0,6)} • ${label.toUpperCase()} OPEN`);
  };
  dc.onclose = () => { if (peer.channels[label] === dc) delete peer.channels[label]; render(state.snapshot); };
  dc.onerror = () => log(`DIRECT P2P • ${peer.id.slice(0,6)} • ${label} ERROR`);
  dc.onmessage = e => { try { handleRTCMessage(peer.id, label, JSON.parse(e.data)); } catch {} };
}
function initRTCForRole() {
  for (const p of state.rtc.peers.values()) { try { p.pc.close(); } catch {} clearInterval(p.beaconTimer); clearInterval(p.pingTimer); clearInterval(p.statsTimer); clearTimeout(p.reconnectTimer); }
  state.rtc.peers.clear(); state.rtc.hostPeerId = null; state.rtc.available = Boolean(window.RTCPeerConnection);
  state.rtc.hostClock = { samples: [], offsetMs: 0, driftPpm: 0, anchorLocalMs: 0, anchorOffsetMs: 0, jitterMs: 0 };
  state.rtc.hostClockLocked = false; state.rtc.hostBeacon = null; state.rtc.hostRttMs = 0; state.rtc.hostJitterMs = 0;
}
function startHostPeer(peerId, name = "Speaker") {
  if (!isHost() || !window.RTCPeerConnection) return;
  const peer = createRTCPeer(peerId, true); if (peer) peer.name = name;
}
function ensureClientHostPeer(hostId) {
  if (isHost() || !hostId || !window.RTCPeerConnection) return;
  state.rtc.hostPeerId = hostId; createRTCPeer(hostId, false);
}
async function handleRTCSignal(fromId, payload) {
  if (!payload) return; let peer = state.rtc.peers.get(fromId); if (!peer) peer = createRTCPeer(fromId, false); if (!peer) return;
  try {
    if (payload.type === "offer") {
      await peer.pc.setRemoteDescription(payload.description);
      const answer = await peer.pc.createAnswer(); await peer.pc.setLocalDescription(answer);
      sendRtcSignal(fromId, { type: "answer", description: peer.pc.localDescription });
      if (!isHost()) state.rtc.hostPeerId = fromId;
      if (peer.pendingCandidates.length) { const q=peer.pendingCandidates.splice(0); for (const c of q) { try { await peer.pc.addIceCandidate(c); } catch {} } }
    } else if (payload.type === "answer") {
      await peer.pc.setRemoteDescription(payload.description);
      if (peer.pendingCandidates.length) { const q=peer.pendingCandidates.splice(0); for (const c of q) { try { await peer.pc.addIceCandidate(c); } catch {} } }
    } else if (payload.type === "candidate") {
      if (peer.pc.remoteDescription) { try { await peer.pc.addIceCandidate(payload.candidate); } catch {} }
      else peer.pendingCandidates.push(payload.candidate);
    }
  } catch (e) { log(`RTC SIGNAL ERROR • ${e.message}`); }
}
function contextTimeToLocalOutputEpoch(contextTime) {
  if (!state.audioCtx || !Number.isFinite(contextTime)) return null;
  const ts = outputTimestamp();
  if (ts) {
    const outputEpoch = performance.timeOrigin + ts.performanceTime;
    return outputEpoch + (contextTime - ts.contextTime) * 1000;
  }
  return localNowMs() + (contextTime - state.audioCtx.currentTime) * 1000;
}
function currentLocalOutputEpoch() {
  const ts = outputTimestamp();
  return ts ? performance.timeOrigin + ts.performanceTime : localNowMs();
}
function hostOutputEpochAt(hostLocalEpoch) {
  const local = localNowMs();
  return currentLocalOutputEpoch() + (finite(hostLocalEpoch, local) - local);
}
function startHostPeerProtocol(peer) {
  if (!isHost() || peer.beaconTimer) return;
  peer.beaconTimer = setInterval(() => {
    if (peer.channels.sync?.readyState !== "open") return;
    const hostNow = localNowMs();
    const hostOutputEpoch = currentLocalOutputEpoch();
    const playing = state.playing && roomStatePlaying();
    const rate = state.audioEngine === "webaudio" && state.source ? finite(state.source.playbackRate.value, 1) : finite(state.mediaEl?.playbackRate, 1);
    rtcSend(peer.id, { k: "beacon", seq: ++state.rtc.pingSeq, hostNow, hostOutputEpoch, position: currentLocalPosition(), playing, rate }, "sync");
  }, 80);
  rtcSend(peer.id, { k: "hello", version: 8, hostNow: localNowMs(), hostOutputEpoch: currentLocalOutputEpoch() }, "control");
}
function startClientHostProtocol(peer) {
  if (isHost() || peer.pingTimer) return;
  const ping = () => { if (peer.channels.sync?.readyState === "open") rtcSend(peer.id, { k: "clockPing", seq: ++state.rtc.pingSeq, t1: localNowMs() }, "sync"); };
  ping(); peer.pingTimer = setInterval(ping, 250);
}
function updateDirectClockFromPong(peerId, m) {
  const t4=localNowMs(), t1=finite(m.t1,NaN), t2=finite(m.t2,NaN), t3=finite(m.t3,NaN); if (![t1,t2,t3].every(Number.isFinite)) return;
  const rtt=(t4-t1)-(t3-t2), offset=((t2-t1)+(t3-t4))/2; if (!(rtt>=0 && rtt<1000)) return;
  const hc=state.rtc.hostClock; hc.samples.push({local:(t1+t4)/2,offset,rtt}); hc.samples=hc.samples.slice(-48);
  const minRtt=Math.min(...hc.samples.map(s=>s.rtt)); const good=hc.samples.filter(s=>s.rtt<=minRtt+Math.max(5,minRtt*0.35)).slice(-32);
  const median=weightedMedian(good.map(s=>({value:s.offset,weight:1/Math.max(1,s.rtt)})));
  const devs=good.map(s=>Math.abs(s.offset-median)).sort((a,b)=>a-b); const jitter=devs[Math.floor(devs.length/2)]*1.4826||0;
  let drift=0;
  if(good.length>=8){ const x0=good[0].local,xm=good.reduce((a,s)=>a+s.local,0)/good.length,ym=good.reduce((a,s)=>a+s.offset,0)/good.length; let num=0,den=0; for(const s of good){const x=s.local-x0,mx=xm-x0;num+=(x-mx)*(s.offset-ym);den+=(x-mx)**2;} if(den>0) drift=clamp((num/den)*1e6,-300,300); }
  const local=localNowMs();
  if(!hc.anchorLocalMs){hc.anchorLocalMs=local;hc.anchorOffsetMs=median;} else {const pred=hc.anchorOffsetMs+(local-hc.anchorLocalMs)*(hc.driftPpm/1e6);const innovation=clamp(median-pred,-80,80);hc.anchorOffsetMs=pred+innovation*.8;hc.anchorLocalMs=local;}
  hc.offsetMs=hc.anchorOffsetMs; hc.driftPpm=hc.driftPpm*.8+drift*.2; hc.jitterMs=hc.jitterMs?hc.jitterMs*.65+jitter*.35:jitter;
  const best=Math.min(...good.map(s=>s.rtt)); state.rtc.hostRttMs=state.rtc.hostRttMs?state.rtc.hostRttMs*.75+best*.25:best; state.rtc.hostJitterMs=hc.jitterMs; state.rtc.hostClockLocked=good.length>=6 && hc.jitterMs<35;
  const p=state.rtc.peers.get(peerId); if(p){p.rttMs=state.rtc.hostRttMs;p.jitterMs=state.rtc.hostJitterMs;}
}
function directClockUsable(){ return state.rtc.hostClock.samples.length >= 4 && state.rtc.hostJitterMs < 50; }
function localFromHost(hostMs){ const c=state.rtc.hostClock,ratio=1+c.driftPpm/1e6; if(!c.anchorLocalMs)return hostMs-c.offsetMs; return c.anchorLocalMs+(hostMs-(c.anchorLocalMs+c.anchorOffsetMs))/ratio; }
function contextTimeForLocalEpoch(localEpoch){ if(!state.audioCtx)return null; const ts=outputTimestamp(); if(ts){const localOut=performance.timeOrigin+ts.performanceTime;return ts.contextTime+(localEpoch-localOut)/1000;} return state.audioCtx.currentTime+(localEpoch-localNowMs())/1000; }
function hostClockNow(){ return localNowMs()+state.rtc.hostClock.offsetMs; }
function hostPositionAt(hostAt){ const p=currentLocalPosition(); if(!state.playing)return p; const dt=Math.max(0,hostAt-localNowMs())/1000; const rate=state.audioEngine==='webaudio'&&state.source?finite(state.source.playbackRate.value,1):finite(state.mediaEl?.playbackRate,1); return p+dt*rate; }
function directLeadMs(){ const peers=[...state.rtc.peers.values()].filter(p=>p.channels.control?.readyState==='open'); const maxRtt=peers.length?Math.max(...peers.map(p=>finite(p.rttMs,0))):20; const maxJ=peers.length?Math.max(...peers.map(p=>finite(p.jitterMs,0))):5; return Math.min(9000,Math.max(1800,1200+maxRtt*6+maxJ*12)); }
function currentHostReferencePosition(){
  if(!directClockUsable()||!state.rtc.hostBeacon)return authoritativeRoomPosition(serverNow());
  const b=state.rtc.hostBeacon;
  const age=localNowMs()-finite(b.receivedAt,0);
  if(age>900){ state.rtc.hostClockLocked=false; return authoritativeRoomPosition(serverNow()); }
  const hostEpoch=finite(b.hostOutputEpoch,NaN);
  const referenceLocal=Number.isFinite(hostEpoch)?localFromHost(hostEpoch):localFromHost(b.hostNow);
  const dt=Math.max(0,(localNowMs()-referenceLocal))/1000;
  return Math.max(0,b.position+(b.playing?dt*b.rate:0));
}
function applyHostBeacon(m){
  if(isHost())return;
  state.rtc.hostBeacon={hostNow:finite(m.hostNow,0),hostOutputEpoch:finite(m.hostOutputEpoch,NaN),position:finite(m.position,0),playing:Boolean(m.playing),rate:finiteClamp(m.rate,.5,2,1),receivedAt:localNowMs()};
}
function expectedPositionAtNow(targetLocal, targetPosition) {
  const remain = Math.max(0, finite(targetLocal, localNowMs()) - localNowMs()) / 1000;
  return Math.max(0, finite(targetPosition, 0) - remain);
}
function softPhaseLock(errorMs, durationMs = 1800) {
  if (state.audioEngine !== "webaudio" || !state.source || !state.audioCtx || !state.playing) return false;
  const correction = clamp(-errorMs / 1800, -0.02, 0.02);
  const t = state.audioCtx.currentTime;
  try {
    state.source.playbackRate.cancelScheduledValues(t);
    state.source.playbackRate.setValueAtTime(1 + correction, t);
    state.source.playbackRate.linearRampToValueAtTime(1, t + durationMs / 1000);
  } catch { return false; }
  log(`PHASE CORRECTION • ${signMs(errorMs)} • ${(1 + correction).toFixed(4)}x for ${durationMs}ms.`);
  return true;
}
function scheduleHostResync(hostAt, position, reason="direct-sync", serverAt=null, commandId=null, hostOutputAt=null, attempt=0, timelineEpoch=null){
  if (!directCommandIsFresh({ timelineEpoch })) return false;
  let hAt=finite(hostAt,0), pos=Math.max(0,finite(position,0));
  const directLocked=directClockUsable();
  let targetLocal;
  if(Number.isFinite(Number(hostOutputAt)) && directLocked){
    const outputAt=finite(hostOutputAt,0);
    const localOutputTarget=localFromHost(outputAt);
    const late=Math.max(0,localNowMs()-localOutputTarget);
    if(late>0){pos+=late/1000; targetLocal=localNowMs()+Math.max(220,state.rtc.hostRttMs*2+state.rtc.hostJitterMs*4);}
    else targetLocal=localOutputTarget;
  } else if(directLocked){
    const hNow=hostClockNow(); const late=Math.max(0,hNow-hAt);
    if(late>0){pos+=late/1000;hAt=hNow+Math.max(220,state.rtc.hostRttMs*2+state.rtc.hostJitterMs*4);}
    targetLocal=localFromHost(hAt);
  } else if(Number.isFinite(Number(serverAt))){
    const sNow=serverNow(); const late=Math.max(0,sNow-finite(serverAt,0));
    if(late>0){pos+=late/1000;serverAt=sNow+Math.max(220,state.rttMs*2+state.clock.jitterMs*4);}
    targetLocal=localNowMs()+(finite(serverAt,sNow)-sNow);
  } else return false;
  const duration=trackDuration(); if(duration) pos=clamp(pos,0,Math.max(0,duration-.005));
  if (state.playing && state.audioEngine === "webaudio") {
    const expectedNow = expectedPositionAtNow(targetLocal, pos);
    const phaseError = (currentLocalPosition() - expectedNow) * 1000;
    if (Math.abs(phaseError) <= 80 && state.audioCtx && state.source) {
      resetDriftController();
      const controller = corePhaseLock?.updatePhaseLock
        ? corePhaseLock.updatePhaseLock(state.driftController, { errorMs: phaseError, dtSec: 0.12 })
        : { correctionPpm: clamp(-phaseError * 900, -20000, 20000) };
      try { state.source.playbackRate.setTargetAtTime(1 + controller.correctionPpm / 1e6, state.audioCtx.currentTime, 0.18); } catch {}
      state.lastRateCorrectionPpm = controller.correctionPpm;
      clearTimeout(state.scheduledTimer);
      state.pendingAudioCommand = { commandId, targetLocal, targetPosition: pos, attempts: clamp(finite(attempt,0),0,3), reason, soft: true };
      state.lastSyncErrorMs = phaseError;
      state.scheduledTimer=setTimeout(checkSyncCommand, 650);
      return true;
    }
  }
  const targetCtxRaw=contextTimeForLocalEpoch(targetLocal); if(!Number.isFinite(targetCtxRaw))return false;
  const command = {commandId,targetLocal,targetPosition:pos,attempts:clamp(finite(attempt,0),0,3),reason};
  state.rtc.lastDirectSyncCommandId=commandId||null;
  if(state.audioEngine==='media'&&state.mediaEl){
    const el=state.mediaEl; clearTimeout(state.scheduledTimer); clearTimeout(state.mediaScheduleTimer);
    try{ el.pause(); el.currentTime=pos; }catch{}
    const delay=Math.max(0,targetLocal-localNowMs()); const applyAt=()=>{
      const late=Math.max(0,(localNowMs()-targetLocal))/1000; const startPos=Math.min(trackDuration()||Infinity,pos+late);
      try{el.currentTime=startPos;}catch{}
      el.volume=state.muted?0:state.volume; el.play().catch(()=>{state.audioEnabled=false;showEnableAudio();log("MEDIA PLAY BLOCKED • tap ENABLE SPEAKER AUDIO and retry sync.");});
    };
    state.positionAtPause=pos; state.scheduledStartServer=null; state.playing=true; state.pendingAudioCommand=command;
    state.mediaScheduleTimer=setTimeout(applyAt,delay);
    state.scheduledTimer=setTimeout(checkSyncCommand,Math.max(750,delay+650));
    return true;
  }
  if(!state.audioCtx||!state.audioBuffer)return false;
  const targetCtx=Math.max(state.audioCtx.currentTime+.08,targetCtxRaw+state.trimMs/1000); const old=state.source,g=state.gainNode.gain,t=state.audioCtx.currentTime;
  g.cancelScheduledValues(t);g.setValueAtTime(state.muted?0:state.volume,t);g.linearRampToValueAtTime(0,Math.max(t+.02,targetCtx-.045));
  if(old)try{old.stop(Math.max(t+.06,targetCtx-.006));}catch{}
  const src=state.audioCtx.createBufferSource();src.buffer=state.audioBuffer;src.playbackRate.value=1;src.connect(state.gainNode);const gen=++state.sourceGeneration;src.start(targetCtx,pos);
  g.setValueAtTime(0,Math.max(t+.08,targetCtx-.003));g.linearRampToValueAtTime(state.muted?0:state.volume,targetCtx+.025);
  state.source=src;state.audioStartCtx=targetCtx;state.sourceStartPosition=pos;state.playbackPosition=pos;state.playbackPositionCtx=targetCtx;state.positionAtPause=pos;state.scheduledStartServer=null;state.playing=true;setMediaSessionState("playing");sourceEndedHandler(src,gen);startDriftControl();refreshWakeLock();
  state.pendingAudioCommand=command; clearTimeout(state.scheduledTimer); state.scheduledTimer=setTimeout(checkSyncCommand,Math.max(750,targetLocal-localNowMs()+650));
  log(`DIRECT OUTPUT LOCK • ${reason} • ${pos.toFixed(3)}s • target in ${Math.max(0,targetLocal-localNowMs()).toFixed(0)}ms • attempt ${command.attempts+1}/4`); return true;
}
function startRTCStats(peer) {
  if (peer.statsTimer) return;
  peer.statsTimer = setInterval(async () => {
    try {
      const reports = await peer.pc.getStats();
      let rtt = 0;
      reports.forEach(report => {
        if (report.type === "candidate-pair" && report.state === "succeeded" && Number.isFinite(report.currentRoundTripTime)) rtt = Math.max(rtt, report.currentRoundTripTime * 1000);
      });
      if (rtt > 0 && rtt < 5000) { peer.rttMs = peer.rttMs ? peer.rttMs * .65 + rtt * .35 : rtt; if (!isHost()) state.rtc.hostRttMs = peer.rttMs; }
      render(state.snapshot);
    } catch {}
  }, 1000);
}
function sendDirectSyncCommand(peerId, hostAt, position, commandId, attempt = 0, timelineEpoch = null) {
  const peer = state.rtc.peers.get(peerId); if (!peer) return false;
  const serverAt = serverFromLocal(hostAt);
  const hostOutputAt = hostOutputEpochAt(hostAt);
  return rtcSend(peerId, { k: "syncAt", hostAt, hostOutputAt, serverAt, position, commandId, attempt, timelineEpoch: timelineEpoch == null ? finite(state.snapshot?.timelineEpoch, state.timelineEpoch) : timelineEpoch }, "control");
}

function handleRTCMessage(peerId, channel, m){
  if(m.k==='clockPing'&&isHost()){const t2=localNowMs();const t3=localNowMs();rtcSend(peerId,{k:'clockPong',seq:m.seq,t1:m.t1,t2,t3},'sync');return;}
  if(m.k==='clockPong'&&!isHost()){updateDirectClockFromPong(peerId,m);return;}
  if(m.k==='beacon'&&!isHost()){applyHostBeacon(m);return;}
  if(m.k==='startAt'&&!isHost()){
    const pending=state.rtc.pendingStart;
    if(pending?.commandId===m.commandId){ clearTimeout(pending.timer); state.rtc.pendingStart=null; }
    scheduleHostResync(m.hostAt,m.position,'host output start',m.serverAt,m.commandId, m.hostOutputAt, 0, m.timelineEpoch);
    return;
  }
  if(m.k==='syncRequest'&&isHost()){
    if(!roomStatePlaying()) return;
    const hostAt=localNowMs()+directLeadMs(); const pos=hostPositionAt(hostAt);
    sendDirectSyncCommand(peerId,hostAt,pos,cryptoRandomId(),finite(m.attempt,0),finite(state.snapshot?.timelineEpoch,state.timelineEpoch)); return;
  }
  if(m.k==='syncAt'&&!isHost()){
    if(!roomStatePlaying()) return;
    scheduleHostResync(m.hostAt,m.position,'host direct',m.serverAt,m.commandId,m.hostOutputAt,finite(m.attempt,0),m.timelineEpoch);
    state.lastSyncErrorMs=0; return;
  }
}

function render(snapshot) {
  if (!snapshot) return;
  state.snapshot = snapshot; state.revision = Math.max(state.revision, finite(snapshot.revision, 0));
  $("#deviceCount").textContent = snapshot.devices.length;
  $("#readyCount").textContent = `${snapshot.ready.prepared && snapshot.ready.total ? Math.min(snapshot.ready.prepared, snapshot.ready.total) : 0} / ${snapshot.ready.total}`;
  $("#startLead").textContent = `${(snapshot.syncLeadMs / 1000).toFixed(1)}s`;
  $("#readyBarrier").textContent = snapshot.track
    ? `AUDIO READY ${snapshot.ready.prepared}/${snapshot.ready.total} • SPEAKER ENABLED ${snapshot.ready.enabled}/${snapshot.ready.total} • CLOCK LOCK ${snapshot.ready.clockLocked}/${snapshot.ready.total}`
    : "Waiting for track and speaker readiness.";

  const errors = snapshot.devices.map(d => finite(d.syncErrorMs));
  const finiteErrors = errors.filter(Number.isFinite);
  const range = finiteErrors.length > 1 ? Math.max(...finiteErrors) - Math.min(...finiteErrors) : null;
  $("#syncRange").textContent = range == null ? "—" : `${Math.max(0, range).toFixed(1)} ms`;
  const rtts = snapshot.devices.map(d => finite(d.rttMs)).filter(v => v > 0);
  const avg = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : 0;
  $("#avgRtt").textContent = avg ? `${avg.toFixed(1)} ms` : "—";

  const pendingGates = Math.max(0, snapshot.ready.prepared - snapshot.ready.enabled);
  const hostNode = snapshot.devices.find(d => d.role === "host");
  const hostGate = Boolean(hostNode?.audioReady) && !Boolean(hostNode?.audioEnabled);
  const gateLabel = hostGate ? " • HOST AUDIO GATE PENDING" : (pendingGates ? ` • ${pendingGates} audio gate${pendingGates === 1 ? "" : "s"} pending` : "");
  $("#healthText").textContent = snapshot.ready.total === 0 ? "Waiting for speakers" : `${snapshot.ready.prepared}/${snapshot.ready.total} decoded • ${snapshot.ready.clockLocked}/${snapshot.ready.total} clocks locked${gateLabel}`;
  if (snapshot.track) {
    $("#trackName").textContent = snapshot.track.name;
    $("#trackMeta").textContent = `${(snapshot.track.bytes / 1024 / 1024).toFixed(2)} MB • SHA ${snapshot.track.sha256?.slice(0, 10) || "local"}`;
    $("#trackState").textContent = snapshot.state.toUpperCase();
    $("#speakerTitle").textContent = snapshot.track.name;
    $("#speakerNowPlaying").textContent = `${snapshot.state.toUpperCase()} • ${fmt(currentRoomMasterPosition())}`;
    $("#dur").textContent = state.audioBuffer ? fmt(state.audioBuffer.duration) : $("#dur").textContent;
  }

  // Room playback readiness is MEDIA + CLOCK readiness. Browser/OS audio activation is a local output gate.
  // The host's Play/Resume gesture is the explicit activation opportunity for the host; remote nodes may
  // remain audio-gated and catch up automatically after their own required activation gesture.
  const startable = isHost() && snapshot.track && snapshot.state === "ready" && snapshot.ready.total > 0 && snapshot.ready.prepared >= snapshot.ready.total && snapshot.ready.clockLocked >= snapshot.ready.total;
  $("#startBtn").disabled = !startable;
  $("#startBtn").textContent = !state.audioEnabled ? "PLAY • ENABLE HOST AUDIO" : "PLAY WHEN READY";
  $("#pauseBtn").disabled = !isHost() || snapshot.state !== "playing";
  $("#resumeBtn").disabled = !isHost() || !["paused", "stopped"].includes(snapshot.state) || snapshot.ready.prepared < snapshot.ready.total || snapshot.ready.clockReady < snapshot.ready.total;
  $("#resumeBtn").textContent = !state.audioEnabled ? "RESUME • ENABLE HOST AUDIO" : "RESUME";
  $("#stopBtn").disabled = !isHost() || !["playing", "pausing", "armed", "stopping"].includes(snapshot.state);
  $("#resetBtn").disabled = !isHost() || !snapshot.track || snapshot.state === "idle";
  $("#syncAllBtn").disabled = !isHost() || snapshot.state !== "playing";
  $("#prevBtn").disabled = !isHost() || !snapshot.queue?.length || snapshot.queueIndex <= 0;
  $("#nextBtn").disabled = !isHost() || !snapshot.queue?.length || (snapshot.repeatMode !== "all" && !snapshot.shuffle && snapshot.queueIndex >= snapshot.queue.length - 1);
  $("#lockBtn").textContent = snapshot.roomLocked ? "UNLOCK ROOM" : "LOCK ROOM";
  $("#targetTime").textContent = snapshot.startAt ? new Date(snapshot.startAt).toLocaleTimeString() : "—";
  $("#localOffset").textContent = signMs(state.clock.offsetMs);
  $("#clockDrift").textContent = `${state.clock.driftPpm >= 0 ? "+" : ""}${state.clock.driftPpm.toFixed(1)} ppm`;
  $("#playbackError").textContent = state.audioReady ? signMs(computeSyncErrorMs()) : "—";
  $("#outputLatency").textContent = state.outputLatencyMs ? `${state.outputLatencyMs.toFixed(1)} ms` : "—";
  $("#telemetryUncertainty").textContent = state.clockUncertaintyMs ? `${state.clockUncertaintyMs.toFixed(1)} ms` : "—";
  $("#audioState").textContent = `${state.audioEngine.toUpperCase()} / ${state.audioCtx?.state?.toUpperCase() || "—"}`;
  const directOpen = [...state.rtc.peers.values()].filter(p => p.channels.control?.readyState === "open").length;
  const pathRtt = directOpen ? state.rtc.hostRttMs : state.rttMs; const pathJitter = directOpen ? state.rtc.hostJitterMs : state.clock.jitterMs;
  $("#network").textContent = `${directOpen ? `P2P RTC ${directOpen}` : "LAN / WS"} • RTT ${pathRtt.toFixed(1)}ms • JITTER ${pathJitter.toFixed(1)}ms`;
  const pathLabel = directOpen && pathJitter <= 15 ? "DIRECT / STABLE" : pathRtt <= 50 && pathJitter <= 10 ? "LAN / STABLE" : pathRtt <= 120 && pathJitter <= 30 ? "GOOD" : "DEGRADED";
  $("#controlHealth").textContent = pathLabel;
  $("#clockUncertainty").textContent = state.clockUncertaintyMs ? `${state.clockUncertaintyMs.toFixed(1)} ms` : "—";
  $("#queueCount").textContent = String(snapshot.queue?.length || 0);
  $("#shuffleBtn").textContent = `SHUFFLE ${snapshot.shuffle ? "ON" : "OFF"}`;
  $("#repeatBtn").textContent = `REPEAT ${(snapshot.repeatMode || "off").toUpperCase()}`;
  renderQueue(snapshot);
  $("#syncQuality").textContent = qualityLabel(Math.abs(computeSyncErrorMs()), !isHost() && directClockUsable() ? state.rtc.hostJitterMs : state.clock.jitterMs);
  $("#wakeState").textContent = state.wakeLock ? "ACTIVE" : "—";

  state.volume = clamp(finite(snapshot.volume, 1), 0, 1); state.muted = Boolean(snapshot.muted); setLocalGain();
  $("#volumeValue").textContent = `${Math.round(state.volume * 100)}%`; $("#masterVolume").value = Math.round(state.volume * 100); $("#muteBtn").textContent = state.muted ? "UNMUTE" : "MUTE";
  renderDevices(snapshot);
  updateSpeakerUI(snapshot);
  updatePlaybackUI();
}

function renderQueue(snapshot) {
  const q = snapshot?.queue || [];
  const el = $("#queueList");
  if (!el) return;
  el.innerHTML = q.length ? q.map((t, i) => `<div class="queue-item ${i === snapshot.queueIndex ? "current" : ""}"><span class="queue-num">${String(i + 1).padStart(2, "0")}</span><span class="queue-name">${esc(t.name)}<span class="substatus">SHA ${esc(t.sha256?.slice(0, 12) || "—")}</span></span><span class="queue-meta">${t.bytes ? `${(t.bytes/1048576).toFixed(1)} MB` : "—"}</span></div>`).join("") : '<div class="tool-note">Queue is empty. Upload a track to add one.</div>';
}

function renderDevices(snapshot) {
  const html = snapshot.devices.map(d => {
    const error = Math.abs(finite(d.syncErrorMs));
    const cls = error <= 10 ? "ok" : error <= 25 ? "warn" : "badtext";
    const trim = d.role === "host" ? "—" : `<span class="trim-controls"><button class="trim-btn" data-client="${esc(d.id)}" data-delta="-100">−100</button><button class="trim-btn" data-client="${esc(d.id)}" data-delta="-25">−25</button><button class="trim-btn" data-client="${esc(d.id)}" data-reset="1">0</button><button class="trim-btn" data-client="${esc(d.id)}" data-delta="25">+25</button><button class="trim-btn" data-client="${esc(d.id)}" data-delta="100">+100</button></span>`;
    const action = isHost() && d.role !== "host" ? `<button class="kick-btn" data-kick="${esc(d.id)}">KICK</button>` : d.id === state.clientId ? "THIS DEVICE" : "";
    const transport = d.rtcState === "connected" ? "RTC-P2P" : d.transport;
    return `<tr><td>${esc(d.name)}</td><td class="${d.role === "host" ? "hostmark" : ""}">${d.role.toUpperCase()}</td><td>${signMs(d.offsetMs)} <span class="ppm">${d.clockDriftPpm >= 0 ? "+" : ""}${d.clockDriftPpm.toFixed(1)}ppm</span></td><td class="${cls}">${signMs(d.syncErrorMs)}</td><td>${finite(d.outputLatencyMs).toFixed(1)}ms</td><td>${trim}</td><td>${finite(d.rttMs).toFixed(1)}ms</td><td>${finite(d.bufferSec).toFixed(1)}s</td><td>${esc(d.status)}<span class="substatus">${transport}</span></td><td>${action}</td></tr>`;
  }).join("");
  $("#devices").innerHTML = html;
}
function qualityLabel(error, jitter) {
  if (!state.audioBuffer) return "PREPARING";
  if (error <= 5 && jitter <= 8) return "LOCKED <5MS";
  if (error <= 12 && jitter <= 20) return "GOOD <12MS";
  if (error <= 25 && jitter <= 40) return "FAIR <25MS";
  return "RESYNCING";
}
function updateSpeakerUI(snapshot) {
  const me = snapshot?.devices?.find(d => d.id === state.clientId);
  const status = me?.status || (state.audioReady ? "ready" : "connected");
  $("#speakerStatus").textContent = status === "playing" ? "PLAYING • following the host's shared audio timeline" : status === "paused" ? "PAUSED • press Resume from the host" : status === "stopped" ? "STOPPED • position is retained; host can Resume" : !state.audioReady ? "PREPARING • downloading and decoding locally" : !state.audioEnabled ? "SPEAKER LOCKED • activate audio once" : !state.clockLocked ? "AUDIO READY • finishing clock lock" : "READY • automatic synchronization is armed";
  $("#speakerReadyNote").textContent = state.audioReady ? (state.audioEnabled ? (state.clockLocked ? `READY • ${state.audioEngine.toUpperCase()} engine + clock lock + local preload` : "READY • clock lock converging") : (IS_IOS ? "Tap ENABLE SPEAKER AUDIO to satisfy iOS/WebKit's user-gesture audio policy." : "AUDIO DECODED • speaker output needs one user gesture")) : "DOWNLOADING / DECODING • playback remains blocked until local audio is ready";
  $("#speakerSync").textContent = `SYNC ${signMs(me?.syncErrorMs ?? computeSyncErrorMs())}`;
  if ($("#iosAudioGate")) $("#iosAudioGate").textContent = `AUDIO ${state.audioEnabled ? "ENABLED" : "LOCKED"}`;
  if ($("#iosEngine")) $("#iosEngine").textContent = `ENGINE ${state.audioEngine.toUpperCase()}${state.audioCtx?.state ? " / " + state.audioCtx.state.toUpperCase() : ""}`;
  if ($("#iosRTC")) { const peer=state.rtc.hostPeerId ? state.rtc.peers.get(state.rtc.hostPeerId) : null; $("#iosRTC").textContent = `DIRECT LINK ${peer?.channels?.control?.readyState === "open" ? "CONNECTED" : "FALLBACK"}`; }
  $("#speakerLatency").textContent = `OUT ${finite(me?.outputLatencyMs ?? state.outputLatencyMs).toFixed(1)}ms`;
  $("#speakerVolume").textContent = `VOL ${Math.round((me?.volume ?? state.volume) * 100)}%`;
  $("#trimLabel").textContent = `LOCAL TRIM ${state.trimMs >= 0 ? "+" : ""}${state.trimMs}ms`;
  $("#syncNowBtn").disabled = !state.audioReady || !snapshot?.track || snapshot.state !== "playing";
}

function createAudioContext() {
  if (state.audioCtx) return state.audioCtx;
  if (!AC) return null;
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
  try { state.audioCtx = new AC({ latencyHint: "interactive" }); } catch { state.audioCtx = new AC(); }
  state.gainNode = state.audioCtx.createGain();
  state.gainNode.gain.value = state.muted ? 0 : state.volume;
  state.gainNode.connect(state.audioCtx.destination);
  state.outputLatencyMs = 1000 * finite(state.audioCtx.outputLatency, 0);
  state.baseLatencyMs = 1000 * finite(state.audioCtx.baseLatency, 0);
  state.audioEngine = "webaudio";
  return state.audioCtx;
}
function primeTone() {
  const ctx = state.audioCtx;
  if (!ctx || ctx.state !== "running") return;
  try {
    const osc = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.02, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    osc.frequency.value = 880; osc.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.05);
  } catch {}
}
async function unlockAudio({ resume = true, testTone = false, fromGesture = false } = {}) {
  const ctx = createAudioContext();
  if (!ctx) { state.audioEngine = "media"; throw new Error("Web Audio API is unavailable on this device."); }
  // iOS/WebKit is strict about user activation. Both audio paths must be primed BEFORE the first await.
  if (fromGesture) { primeActivationBuffer(ctx); primeMediaGesture(); }
  let resumePromise = null;
  if (resume && ctx.state !== "running") { try { resumePromise = ctx.resume(); } catch {} }
  if ((testTone || fromGesture) && ctx.state === "running") primeTone();
  if (resumePromise) { try { await Promise.race([resumePromise.catch(()=>{}), new Promise(r=>setTimeout(r,900))]); } catch {} }
  if ((testTone || fromGesture) && ctx.state === "running") primeTone();
  state.audioEnabled = ctx.state === "running"; state.enabled = state.audioEnabled;
  state.outputLatencyMs = 1000 * finite(ctx.outputLatency, 0); state.baseLatencyMs = 1000 * finite(ctx.baseLatency, 0);
  if (state.audioEnabled) { hideEnableAudio(); await requestWakeLock(); } else showEnableAudio();
  if (state.snapshot?.track && state.audioEnabled) sendReady("ready"); else sendTelemetry("connected");
  render(state.snapshot); return state.audioEnabled;
}
function primeActivationBuffer(ctx) {
  try {
    const b=ctx.createBuffer(1,Math.max(1,Math.floor(ctx.sampleRate*0.03)),ctx.sampleRate);
    const src=ctx.createBufferSource(); const g=ctx.createGain(); src.buffer=b; g.gain.value=0.00001; src.connect(g); g.connect(ctx.destination); src.start(0);
  } catch {}
}
function makeSilentWavBlob(seconds = 0.12, sampleRate = 22050) {
  const frames = Math.max(1, Math.floor(sampleRate * seconds));
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const write = (o, str) => [...str].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  const u16 = (o, v) => view.setUint16(o, v, true); const u32 = (o, v) => view.setUint32(o, v, true);
  write(0, "RIFF"); u32(4, 36 + frames * 2); write(8, "WAVE"); write(12, "fmt "); u32(16, 16); u16(20, 1); u16(22, 1); u32(24, sampleRate); u32(28, sampleRate * 2); u16(32, 2); u16(34, 16); write(36, "data"); u32(40, frames * 2);
  return new Blob([buffer], { type: "audio/wav" });
}
function primeMediaGesture() {
  try {
    const el = getMediaElement(); el.volume=0; el.muted=false;
    const url=URL.createObjectURL(makeSilentWavBlob()); const old=el.src; el.src=url; el.load();
    const p=el.play();
    Promise.resolve(p).catch(()=>{}).finally(()=>{try{el.pause();el.currentTime=0;if(old)el.src=old;else el.removeAttribute("src");el.load();}catch{} try{URL.revokeObjectURL(url);}catch{}});
  } catch {}
}

function showEnableAudio() { $("#enableAudioBtn")?.classList.remove("hidden"); }
function hideEnableAudio() { $("#enableAudioBtn")?.classList.add("hidden"); }
$("#enableAudioBtn")?.addEventListener("click", async () => {
  try { await unlockAudio({ resume: true, testTone: true, fromGesture: true }); if (state.snapshot?.track) await prepareTrack(state.snapshot.track); log("SPEAKER OUTPUT ENABLED • browser audio gate cleared."); }
  catch (e) { log(`AUDIO ENABLE FAILED • ${e.message}`); }
});
if (navigator.audioSession?.addEventListener) {
  try { navigator.audioSession.addEventListener("statechange", () => { if (navigator.audioSession.state === "active" && state.enabled && roomStatePlaying()) { try { state.audioCtx?.resume(); } catch {} requestBestSync("audio-session-recovery"); } }); } catch {}
}
async function requestWakeLock() {
  if (!state.enabled || !navigator.wakeLock?.request || state.wakeLock) return;
  try { state.wakeLock = await navigator.wakeLock.request("screen"); state.wakeLock.addEventListener?.("release", () => { state.wakeLock = null; }); } catch {}
}
async function refreshWakeLock() { if (state.playing) await requestWakeLock(); }
function requestBestSync(reason = "recovery") {
  if (!state.audioEnabled || !roomStatePlaying()) return false;
  if (state.rtc.hostPeerId && rtcSend(state.rtc.hostPeerId, { k: "syncRequest", requestId: cryptoRandomId(), reason, attempt: 0 }, "control")) {
    log(`SYNC RECOVERY • ${reason} • direct host output requested.`); return true;
  }
  send({ type: "requestSync" }); log(`SYNC RECOVERY • ${reason} • LAN fallback requested.`); return true;
}

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible") {
    if (state.audioCtx?.state === "suspended" && state.enabled) {
      try { await Promise.race([state.audioCtx.resume().catch(()=>{}), new Promise(r=>setTimeout(r,900))]); } catch {}
      state.audioEnabled = state.audioCtx.state === "running";
      sendReady(state.audioEnabled ? "ready" : "audio-gesture");
      if (state.audioEnabled && roomStatePlaying()) requestBestSync("visibility");
    }
    refreshWakeLock();
  }
});
window.addEventListener("pageshow", () => { if (roomStatePlaying() && state.audioEnabled) { if (state.audioCtx?.state !== "running") state.audioCtx?.resume?.().catch?.(()=>{}); requestBestSync("pageshow"); } });

function startClockSync() {
  clearInterval(state.syncTimer);
  state.clock.samples = [];
  let seq = 0;
  const tick = () => { if (state.ws?.readyState !== WebSocket.OPEN) return; const t1 = localNowMs(); send({ type: "sync", t1, seq: ++seq }); };
  tick();
  let sent = 0;
  const burst = setInterval(() => { if (++sent >= 20) return clearInterval(burst); tick(); }, 100);
  state.syncTimer = setInterval(tick, 500);
}
function weightedMedian(items) {
  const sorted = [...items].sort((a, b) => a.value - b.value); const total = sorted.reduce((s, x) => s + x.weight, 0); let acc = 0;
  for (const x of sorted) { acc += x.weight; if (acc >= total / 2) return x.value; }
  return sorted.at(-1)?.value ?? 0;
}
function finishClockSync(m) {
  const t4 = localNowMs(), t1 = finite(m.t1, NaN), t2 = finite(m.t2, NaN), t3 = finite(m.t3, NaN);
  if (![t1, t2, t3].every(Number.isFinite)) return;
  const rtt = (t4 - t1) - (t3 - t2);
  if (!(rtt >= 0 && rtt < 1000)) return;
  const sample = { t1, t2, t3, t4, rtt, offset: ((t2 - t1) + (t3 - t4)) / 2, midpoint: (t1 + t4) / 2 };
  state.clock.samples.push(sample); state.clock.samples = state.clock.samples.slice(-48);
  const estimate = coreEstimateClock ? coreEstimateClock(state.clock.samples, { minSamples: 3, maxSamples: 48 }) : null;
  if (estimate) {
    const local = localNowMs();
    if (!state.clock.anchorLocalMs) { state.clock.anchorLocalMs = local; state.clock.anchorOffsetMs = estimate.offsetMs; state.clock.offsetMs = estimate.offsetMs; }
    else {
      const predicted = state.clock.anchorOffsetMs + (local - state.clock.anchorLocalMs) * (state.clock.driftPpm / 1e6);
      const innovation = clamp(estimate.offsetMs - predicted, -150, 150);
      state.clock.anchorOffsetMs = predicted + innovation * 0.65; state.clock.anchorLocalMs = local; state.clock.offsetMs = state.clock.anchorOffsetMs;
    }
    state.clock.driftPpm = state.clock.driftPpm * 0.75 + estimate.driftPpm * 0.25;
    state.clock.jitterMs = state.clock.jitterMs ? state.clock.jitterMs * 0.7 + estimate.jitterMs * 0.3 : estimate.jitterMs;
    state.rttMs = state.rttMs ? state.rttMs * 0.75 + estimate.rttMs * 0.25 : estimate.rttMs;
    state.clockUncertaintyMs = state.clockUncertaintyMs ? state.clockUncertaintyMs * 0.7 + estimate.uncertaintyMs * 0.3 : estimate.uncertaintyMs;
    state.syncConfidence = estimate.confidence;
    state.clockLocked = estimate.locked && estimate.jitterMs < 35;
  } else {
    // Fallback for a browser that has not loaded the shared module yet.
    const offsets=state.clock.samples.map(s=>s.offset).sort((a,b)=>a-b); const med=offsets[Math.floor(offsets.length/2)]||0;
    state.clock.offsetMs=med; state.clockUncertaintyMs=Math.max(1, rtt/2); state.clockLocked=state.clock.samples.length>=6;
  }
  if (state.audioBuffer) sendReady("clock-sync");
}

function sendReady(status = "ready") {
  if (!state.snapshot?.track) return;
  send({ type: "ready", trackId: state.snapshot.track.id, durationSec: trackDuration(), audioReady: state.audioReady, audioEnabled: state.audioEnabled, bufferSec: trackDuration(), outputLatencyMs: state.outputLatencyMs, baseLatencyMs: state.baseLatencyMs, clockLocked: state.clockLocked, clockSampleCount: state.clock.samples.length, clockUncertaintyMs: state.clockUncertaintyMs, syncConfidence: state.syncConfidence });
  sendTelemetry(status);
}
function sendTelemetry(status) {
  send({ type: "telemetry", offsetMs: state.clock.offsetMs, clockDriftPpm: state.clock.driftPpm, clockJitterMs: state.clock.jitterMs, clockUncertaintyMs: state.clockUncertaintyMs, syncConfidence: state.syncConfidence, rttMs: state.rttMs, syncErrorMs: computeSyncErrorMs(), lastSyncErrorMs: state.lastSyncErrorMs, rateCorrectionPpm: finite(state.lastRateCorrectionPpm, 0), durationSec: trackDuration(), outputLatencyMs: state.outputLatencyMs, baseLatencyMs: state.baseLatencyMs, bufferSec: Math.max(0, trackDuration() - currentLocalPosition()), status, audioReady: state.audioReady, audioEnabled: state.audioEnabled, clockLocked: state.clockLocked, clockSampleCount: state.clock.samples.length, transport: state.rtc.hostPeerId && state.rtc.peers.get(state.rtc.hostPeerId)?.channels?.control?.readyState === "open" ? "RTC-P2P" : "LAN" });
}
function trackDuration() { return state.audioBuffer?.duration || finite(state.mediaEl?.duration, 0); }
function setMediaSessionState(value) { try { if (navigator.mediaSession) navigator.mediaSession.playbackState = value; } catch {} }
function configureMediaSession(track) {
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
  if (!navigator.mediaSession) return;
  try { navigator.mediaSession.metadata = new MediaMetadata({ title: track?.name || "SonicSync", artist: "SonicSync", album: "Local distributed audio" }); } catch {}
  try { navigator.mediaSession.setActionHandler("play", () => send({ type: "resume", leadMs: 3000 })); } catch {}
  try { navigator.mediaSession.setActionHandler("pause", () => send({ type: "pause" })); } catch {}
  try { navigator.mediaSession.setActionHandler("seekto", d => { if (Number.isFinite(d.seekTime)) send({ type: "seek", position: d.seekTime, duration: trackDuration() }); }); } catch {}
}


async function fetchTrackBytes(track) {
  let cache = null, response = null;
  const cacheAllowed = window.isSecureContext || location.hostname === "localhost";
  if (cacheAllowed && window.caches) { try { cache = await caches.open("sonicsync-media-v10"); response = await cache.match(track.url); } catch {} }
  if (response) { log(`MEDIA CACHE HIT • ${track.name}`); return response.arrayBuffer(); }
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      log(`MEDIA PRELOAD • ${track.name} • attempt ${attempt}/5`);
      response = await fetch(track.url, { cache: "default", headers: { Accept: "audio/*,*/*;q=0.8" } });
      if (!response.ok) throw new Error(`Media HTTP ${response.status}`);
      if (cache) { try { await cache.put(track.url, response.clone()); } catch {} }
      return await response.arrayBuffer();
    } catch (e) { lastErr = e; if (attempt < 5) await new Promise(r => setTimeout(r, Math.min(1200, attempt * 250))); }
  }
  throw lastErr || new Error("Media download failed.");
}
async function prepareTrack(track) {
  if (!track?.url || !track.id) return null;
  if (state.trackLoadKey === track.id && (state.audioBuffer || state.mediaEl?.readyState >= 2)) return state.audioBuffer || state.mediaEl;
  if (state.trackLoadKey === track.id && state.trackLoadPromise) return state.trackLoadPromise;
  if (state.trackLoadKey && state.trackLoadKey !== track.id) { stopLocalPlayback(0); state.audioBuffer = null; state.trackLoadKey = null; }
  state.trackLoadKey = track.id; state.audioReady = false; state.lastError = ""; sendTelemetry("preparing"); render(state.snapshot);

  state.trackLoadPromise = (async () => {
    try {
      const ctx = createAudioContext();
      if (ctx) {
        configureMediaSession(track);
        const bytes = await fetchTrackBytes(track);
        try {
          const decoded = await ctx.decodeAudioData(bytes.slice(0));
          const decodedMB = (decoded.length * decoded.numberOfChannels * 4) / (1024 * 1024);
          const limitMB = finite(navigator.deviceMemory, 4) <= 2 ? 120 : 260;
          if (decodedMB > limitMB) throw new Error(`Decoded audio is ${decodedMB.toFixed(0)} MB; device safety limit is ${limitMB} MB.`);
          state.audioBuffer = decoded; state.audioEngine = "webaudio"; state.positionAtPause = 0; state.playbackPosition = 0; state.playbackPositionCtx = state.audioCtx?.currentTime ?? 0; state.audioReady = true;
          state.outputLatencyMs = 1000 * finite(ctx.outputLatency, 0); state.baseLatencyMs = 1000 * finite(ctx.baseLatency, 0);
          $("#dur").textContent = fmt(decoded.duration); sendReady("ready"); log(`AUDIO READY • ${decoded.duration.toFixed(2)}s decoded locally • Web Audio.`); render(state.snapshot); return decoded;
        } catch (decodeErr) {
          log(`WEB AUDIO DECODE FAILED • ${decodeErr.message} • trying media fallback.`);
        }
      }
      // HTMLMediaElement fallback is especially useful for WebKit/iOS codec paths.
      configureMediaSession(track);
      const el = getMediaElement();
      el.autoplay = false; el.muted = false; el.src = track.url; el.preload = "auto"; el.load();
      if (IS_IOS && state.audioEnabled) { try { const p = el.play(); p?.catch?.(()=>{}); } catch {} }
      await waitForMediaReady(el);
      state.mediaEl = el; state.audioEngine = "media"; state.audioReady = Number.isFinite(el.duration) && el.duration > 0; state.positionAtPause = 0; state.playbackPosition = 0; state.playbackPositionCtx = state.audioCtx?.currentTime ?? 0;
      if (state.audioCtx && !state.mediaNode) { try { state.mediaNode = state.audioCtx.createMediaElementSource(el); state.mediaNode.connect(state.gainNode); } catch {} }
      $("#dur").textContent = fmt(el.duration); sendReady("ready"); log(`AUDIO READY • ${el.duration.toFixed(2)}s • HTML media fallback.`); render(state.snapshot); return el;
    } catch (e) {
      state.audioReady = false; state.lastError = e?.message || "Track preparation failed"; setStatus("error"); log(`PRELOAD FAILED • ${state.lastError}`); sendTelemetry("error"); render(state.snapshot); return null;
    } finally { state.trackLoadPromise = null; }
  })();
  return state.trackLoadPromise;
}
function getMediaElement() {
  if (state.mediaEl) return state.mediaEl;
  let el = $("#compatAudio");
  if (!el) { el = document.createElement("audio"); el.id = "compatAudio"; el.setAttribute("playsinline", ""); el.preload = "auto"; document.body.appendChild(el); }
  el.setAttribute("playsinline", ""); el.setAttribute("webkit-playsinline", ""); return el;
}
function waitForMediaReady(el) {
  return new Promise((resolve, reject) => {
    if (Number.isFinite(el.duration) && el.duration > 0 && el.readyState >= 2) return resolve();
    const ok = () => { cleanup(); resolve(); }; const fail = () => { cleanup(); reject(new Error("Browser could not load the audio format.")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Media preload timed out.")); }, 20_000);
    const cleanup = () => { clearTimeout(timer); el.removeEventListener("loadedmetadata", ok); el.removeEventListener("canplay", ok); el.removeEventListener("error", fail); };
    el.addEventListener("loadedmetadata", ok, { once: true }); el.addEventListener("canplay", ok, { once: true }); el.addEventListener("error", fail, { once: true });
  });
}
function setStatus(value) { if ($("#trackState")) $("#trackState").textContent = String(value).toUpperCase(); }

function outputTimestamp() {
  if (!state.audioCtx?.getOutputTimestamp) return null;
  try { const ts = state.audioCtx.getOutputTimestamp(); if (Number.isFinite(ts.contextTime) && Number.isFinite(ts.performanceTime)) return ts; } catch {}
  return null;
}
function contextTimeForServer(targetServerMs) {
  if (!state.audioCtx) return null;
  const ts = outputTimestamp();
  if (ts) {
    const localOutputEpoch = performance.timeOrigin + ts.performanceTime;
    return ts.contextTime + (targetServerMs - serverFromLocal(localOutputEpoch)) / 1000;
  }
  return state.audioCtx.currentTime + (targetServerMs - serverNow()) / 1000;
}
function authoritativeRoomPosition(atServer = serverNow()) {
  const s = state.snapshot; if (!s?.track) return 0;
  if (["playing", "pausing", "stopping"].includes(s.state) && s.startedAt != null) {
    const base = Math.max(0, (atServer - s.startedAt) / 1000);
    return isHost() ? base : Math.max(0, base + finite(s.authoritativeAudioBiasMs, 0) / 1000);
  }
  return Math.max(0, finite(s.position, 0));
}
function currentRoomMasterPosition() { return !isHost() && directClockUsable() ? currentHostReferencePosition() : authoritativeRoomPosition(serverNow()); }
function integratePlaybackEstimate() {
  const duration=trackDuration();
  if(!duration || state.audioEngine!=='webaudio' || !state.source || !state.playing || !state.audioCtx) return;
  const nowCtx=outputTimestamp()?.contextTime ?? state.audioCtx.currentTime;
  const startCtx=finite(state.audioStartCtx,nowCtx);
  if(nowCtx < startCtx){ state.playbackPositionCtx=startCtx; return; }
  const lastCtx=Math.max(startCtx,finite(state.playbackPositionCtx,startCtx));
  const dt=Math.max(0,nowCtx-lastCtx);
  const rate=finite(state.source?.playbackRate?.value,1);
  state.playbackPosition=clamp(finite(state.playbackPosition,state.sourceStartPosition)+dt*rate,0,duration);
  state.playbackPositionCtx=nowCtx;
}
function currentLocalPosition() {
  const duration=trackDuration();
  if(!duration) return 0;
  if(state.audioEngine==='media'&&state.mediaEl) return clamp(finite(state.mediaEl.currentTime,state.positionAtPause),0,duration);
  if(!state.audioBuffer||!state.source||!state.playing) return clamp(finite(state.positionAtPause,state.playbackPosition||0),0,duration);
  integratePlaybackEstimate();
  return clamp(finite(state.playbackPosition,state.sourceStartPosition),0,duration);
}
function computeSyncErrorMs() { if (!state.audioReady || !state.snapshot?.track || !roomStatePlaying()) return 0; if (state.scheduledStartServer && serverNow() < state.scheduledStartServer) return 0; return (currentLocalPosition() - currentRoomMasterPosition()) * 1000; }
function normalizeTarget(startServer, position) {
  const nowS = serverNow(); const lateMs = Math.max(0, nowS - startServer); const duration = trackDuration();
  let pos = Math.max(0, finite(position, 0) + lateMs / 1000);
  if (duration) pos = clamp(pos, 0, Math.max(0, duration - 0.005));
  const targetServer = lateMs > 0 ? nowS + Math.max(90, Math.min(400, state.rttMs + state.clock.jitterMs * 2)) : startServer;
  return { targetServer, position: pos };
}
function sourceEndedHandler(src, generation) {
  src.onended = () => {
    if (generation !== state.sourceGeneration || state.source !== src) return;
    const duration = trackDuration();
    if (state.playing && currentLocalPosition() >= duration - 0.1) { state.playing = false; state.positionAtPause = duration; sendTelemetry("stopped"); }
  };
}
function scheduleSource(startServer, position, reason = "start", commandId = null) {
  if (!state.audioReady || !state.audioEnabled) return false;
  const normalized = normalizeTarget(startServer, position);
  const safePos = normalized.position;
  if (state.audioEngine === "media" && state.mediaEl) return scheduleMediaSource(normalized.targetServer, safePos, reason);
  if (!state.audioCtx || !state.audioBuffer) return false;
  const targetCtxRaw = contextTimeForServer(normalized.targetServer);
  if (!Number.isFinite(targetCtxRaw)) return false;
  const targetCtx = Math.max(state.audioCtx.currentTime + 0.03, targetCtxRaw + state.trimMs / 1000);
  const old = state.source; const g = state.gainNode.gain; const t = state.audioCtx.currentTime;
  try {
    if (old && old !== state.source) { try { old.stop(); } catch {} }
    g.cancelScheduledValues(t); g.setValueAtTime(0, t); g.linearRampToValueAtTime(state.muted ? 0 : state.volume, Math.max(t + 0.01, targetCtx));
    if (old) { try { old.stop(Math.max(t + 0.02, targetCtx - 0.005)); } catch {} }
    const src = state.audioCtx.createBufferSource(); src.buffer = state.audioBuffer; src.playbackRate.value = 1; src.connect(state.gainNode);
    const generation = ++state.sourceGeneration; src.start(targetCtx, safePos);
    state.source = src; state.audioStartCtx = targetCtx; state.sourceStartPosition = safePos; state.playbackPosition = safePos; state.playbackPositionCtx = targetCtx; state.positionAtPause = safePos; state.scheduledStartServer = normalized.targetServer; state.playing = true; setMediaSessionState("playing"); sourceEndedHandler(src, generation); startDriftControl(); refreshWakeLock();
    const hostOutputAt = isHost() ? contextTimeToLocalOutputEpoch(targetCtx) : null;
    if (isHost() && hostOutputAt != null) {
      const id = commandId || `start-${Date.now()}`;
      rtcBroadcast({ k: "startAt", timelineEpoch: finite(state.snapshot?.timelineEpoch, state.timelineEpoch), hostAt: localNowMs() + Math.max(0, normalized.targetServer - serverNow()), hostOutputAt, serverAt: normalized.targetServer, position: safePos, commandId: id }, "control");
    }
    log(`AUDIO SCHEDULED • ${reason} • pos ${safePos.toFixed(3)}s • effective in ${Math.max(0, normalized.targetServer - serverNow()).toFixed(0)}ms.`);
    return true;
  } catch (e) { log(`SCHEDULE ERROR • ${e.message}`); return false; }
}
function scheduleMediaSource(startServer, position, reason) {
  const el = state.mediaEl; if (!el) return false;
  clearTimeout(state.mediaScheduleTimer); clearTimeout(state.scheduledTimer);
  const safePos=clamp(position,0,Math.max(0,trackDuration()-0.01));
  try { el.pause(); el.currentTime=safePos; } catch {}
  state.positionAtPause=safePos; state.scheduledStartServer=startServer; state.playing=true; el.playbackRate=1; el.volume=0;
  const delay=Math.max(0,startServer-serverNow());
  state.mediaScheduleTimer=setTimeout(()=>{
    const late=Math.max(0,serverNow()-startServer)/1000; const p=Math.min(trackDuration()||Infinity,safePos+late);
    try{el.currentTime=p;}catch{}
    const playPromise=el.play(); if(playPromise?.catch) playPromise.catch(()=>{state.audioEnabled=false;showEnableAudio();log("MEDIA PLAY BLOCKED • tap ENABLE SPEAKER AUDIO and retry sync.");});
    el.volume=state.muted?0:state.volume;
  },delay);
  state.scheduledTimer=setTimeout(checkSyncCommand,Math.max(750,delay+650));
  startDriftControl(); refreshWakeLock(); log(`MEDIA FALLBACK SCHEDULED • ${reason}`); return true;
}
async function scheduleStart(startAt, position = 0, reason = "room-start", commandId = null, timelineEpoch = null) {
  if (!directCommandIsFresh({ timelineEpoch })) return;
  if (!state.audioBuffer && state.audioEngine !== "media") await prepareTrack(state.snapshot?.track);
  if (!state.audioReady) { log("START WAITING • local audio is not ready."); return; }
  if (!state.audioEnabled) { showEnableAudio(); return; }
  clearTimeout(state.rtc.pendingStart?.timer); state.rtc.pendingStart = null;
  if (!isHost() && state.rtc.hostPeerId && state.rtc.peers.get(state.rtc.hostPeerId)?.channels.control?.readyState === "open") {
    const id = commandId || `server-start-${Date.now()}`;
    const wait = Math.max(0, startAt - serverNow() - 450);
    const timer = setTimeout(() => {
      if (state.rtc.pendingStart?.commandId !== id) return;
      state.rtc.pendingStart = null; scheduleSource(startAt, position, reason, id); sendTelemetry("scheduled-fallback");
    }, wait);
    state.rtc.pendingStart = { commandId: id, timer };
    log(`START • waiting for host output clock • fallback armed ${wait.toFixed(0)}ms before target.`);
    return;
  }
  scheduleSource(startAt, position, reason, commandId); sendTelemetry("scheduled");
}
async function scheduleResync(effectiveAt, position, reason = "sync", commandId = null, timelineEpoch = null) {
  if (!directCommandIsFresh({ timelineEpoch })) return;
  if (!state.audioReady) { await prepareTrack(state.snapshot?.track); if (!state.audioReady) return; }
  if (!state.audioEnabled) { showEnableAudio(); return; }
  const ok = scheduleFadeResync(effectiveAt, position, reason);
  if (ok) {
    const priorAttempt = state.pendingAudioCommand?.attempts || 0;
    state.pendingAudioCommand = { commandId, targetServer: effectiveAt, targetPosition: position, attempts: priorAttempt, reason };
    clearTimeout(state.scheduledTimer);
    state.scheduledTimer = setTimeout(checkSyncCommand, Math.max(600, effectiveAt - serverNow() + 700));
    sendTelemetry("syncing");
  }
}
function scheduleFadeResync(effectiveAt, position, reason) {
  const normalized = normalizeTarget(effectiveAt, position);
  if (state.audioEngine === "media" && state.mediaEl) return scheduleMediaSource(normalized.targetServer, normalized.position, reason);
  if (!state.audioCtx || !state.audioBuffer) return false;
  const targetRaw = contextTimeForServer(normalized.targetServer); if (!Number.isFinite(targetRaw)) return false;
  const targetCtx = Math.max(state.audioCtx.currentTime + 0.08, targetRaw + state.trimMs / 1000);
  const old = state.source; const g = state.gainNode.gain; const t = state.audioCtx.currentTime;
  try {
    g.cancelScheduledValues(t); g.setValueAtTime(state.muted ? 0 : state.volume, t);
    const fadeOutAt = Math.max(t + 0.02, targetCtx - 0.04); g.linearRampToValueAtTime(0, fadeOutAt);
    if (old) { try { old.stop(Math.max(t + 0.05, targetCtx - 0.004)); } catch {} }
    const src = state.audioCtx.createBufferSource(); src.buffer = state.audioBuffer; src.playbackRate.value = 1; src.connect(state.gainNode);
    const generation = ++state.sourceGeneration; const safePos = normalized.position; src.start(targetCtx, safePos);
    g.setValueAtTime(0, Math.max(t + 0.07, targetCtx - 0.002)); g.linearRampToValueAtTime(state.muted ? 0 : state.volume, targetCtx + 0.025);
    state.source = src; state.audioStartCtx = targetCtx; state.sourceStartPosition = safePos; state.playbackPosition = safePos; state.playbackPositionCtx = targetCtx; state.positionAtPause = safePos; state.scheduledStartServer = normalized.targetServer; state.playing = true; setMediaSessionState("playing"); sourceEndedHandler(src, generation); startDriftControl(); refreshWakeLock();
    log(`PHASE RE-LOCK • ${reason} • ${safePos.toFixed(3)}s • target in ${Math.max(0, normalized.targetServer - serverNow()).toFixed(0)}ms.`);
    return true;
  } catch (e) { log(`RESYNC ERROR • ${e.message}`); return false; }
}
function checkSyncCommand() {
  if (!state.pendingAudioCommand || !roomStatePlaying()) { state.pendingAudioCommand = null; return; }
  const error = computeSyncErrorMs(); state.lastSyncErrorMs = error;
  send({ type: "syncApplied", errorMs: error, commandId: state.pendingAudioCommand.commandId || null });
  if (Math.abs(error) > 12 && state.pendingAudioCommand.attempts < 3) {
    const attempt = ++state.pendingAudioCommand.attempts;
    if (state.rtc.hostPeerId && rtcSend(state.rtc.hostPeerId, { k: "syncRequest", requestId: cryptoRandomId(), reason: "verify-retry", attempt }, "control")) {
      log(`SYNC VERIFY • ${signMs(error)} • direct peer retry ${attempt}/3.`);
    } else {
      send({ type: "syncMismatch", errorMs: error, attempt }); log(`SYNC VERIFY • ${signMs(error)} • LAN retry ${attempt}/3.`);
    }
    clearTimeout(state.scheduledTimer); state.scheduledTimer=setTimeout(checkSyncCommand, 800);
  } else {
    log(`SYNC VERIFY • ${signMs(error)} • ${Math.abs(error) <= 12 ? "LOCKED" : "reported"}.`);
    state.pendingAudioCommand = null;
  }
}
function schedulePause(effectiveAt, position) {
  const normalized = normalizeTarget(effectiveAt, position); const duration = trackDuration();
  if (state.audioEngine === "media" && state.mediaEl) {
    const targetMs = Math.max(0, normalized.targetServer - serverNow());
    clearTimeout(state.mediaScheduleTimer); state.mediaScheduleTimer = null; state.mediaEl.volume = 0; clearTimeout(state.scheduledTimer); state.scheduledTimer = setTimeout(() => { try { state.mediaEl.pause(); } catch {} state.positionAtPause = clamp(normalized.position, 0, duration); try { state.mediaEl.currentTime = state.positionAtPause; } catch {} state.playing = false; }, targetMs + 20); return;
  }
  if (!state.audioCtx || !state.source) return commitRoomStop(position, "paused");
  const targetCtx = Math.max(state.audioCtx.currentTime + 0.05, contextTimeForServer(normalized.targetServer) + state.trimMs / 1000); const g = state.gainNode.gain; const t = state.audioCtx.currentTime;
  g.cancelScheduledValues(t); g.setValueAtTime(state.muted ? 0 : state.volume, t); g.linearRampToValueAtTime(0, targetCtx);
  try { state.source.stop(targetCtx + 0.01); } catch {}
}
function scheduleStop(effectiveAt, position) { schedulePause(effectiveAt, position); }
function commitRoomStop(position, mode) { stopLocalPlayback(position); state.playing = false; if (state.snapshot) state.snapshot.position = finite(position, 0); log(`${mode.toUpperCase()} • position retained at ${fmt(finite(position, 0))}.`); sendTelemetry(mode); }
function stopLocalPlayback(position = state.positionAtPause) {
  clearPendingStart();
  state.pendingAudioCommand = null;
  clearTimeout(state.scheduledTimer); state.scheduledTimer = null; clearTimeout(state.mediaScheduleTimer); state.mediaScheduleTimer = null;
  if (state.source) { try { state.source.stop(); } catch {} }
  state.source = null; state.sourceGeneration += 1; state.playing = false; state.scheduledStartServer = null; setMediaSessionState("paused"); state.positionAtPause = Math.max(0, finite(position)); state.playbackPosition = state.positionAtPause; state.playbackPositionCtx = state.audioCtx?.currentTime ?? 0;
  if (state.mediaEl) { try { state.mediaEl.pause(); state.mediaEl.currentTime = state.positionAtPause; } catch {} }
  if (state.gainNode && state.audioCtx) { const t = state.audioCtx.currentTime; state.gainNode.gain.cancelScheduledValues(t); state.gainNode.gain.setValueAtTime(state.muted ? 0 : state.volume, t); }
  clearInterval(state.driftTimer); if (state.wakeLock) { try { state.wakeLock.release(); } catch {} state.wakeLock = null; }
}
function resetLocal() { stopLocalPlayback(0); state.positionAtPause = 0; if (state.mediaEl) try { state.mediaEl.currentTime = 0; } catch {}; if (state.audioBuffer) $("#seek").value = 0; log("RESET • track returned to 00:00."); }
function seekLocal(position) { const p = clamp(finite(position, 0), 0, Math.max(0, trackDuration() - 0.01)); state.positionAtPause = p; if (state.audioEngine === "media" && state.mediaEl) try { state.mediaEl.currentTime = p; } catch {} else if (state.playing) scheduleFadeResync(serverNow() + 300, p, "local-seek"); else if (state.audioBuffer) $("#seek").value = Math.round((p / state.audioBuffer.duration) * 1000); }
function resetDriftController() {
  state.driftController = corePhaseLock?.createPhaseLockState?.() || { filteredErrorMs: 0, integralMsSec: 0, initialized: false, correctionPpm: 0 };
}
function startDriftControl() {
  clearInterval(state.driftTimer);
  resetDriftController();
  let lastTick = performance.now();
  state.driftTimer = setInterval(() => {
    if (!state.playing || !state.snapshot?.track || !roomStatePlaying()) return;
    if (state.scheduledStartServer && serverNow() < state.scheduledStartServer) return;
    const now = performance.now();
    const dtSec = Math.max(0.05, Math.min(0.5, (now - lastTick) / 1000));
    lastTick = now;
    const error = computeSyncErrorMs(); state.lastSyncErrorMs = error;
    if (Math.abs(error) > 80) {
      const nowMs = localNowMs();
      if (!state.pendingAudioCommand && nowMs - state.lastAutoSyncRequestAt > 1400) {
        state.lastAutoSyncRequestAt = nowMs;
        resetDriftController();
        const reason = `auto-drift ${error.toFixed(1)}ms`;
        if (state.rtc.hostPeerId && rtcSend(state.rtc.hostPeerId, { k: "syncRequest", requestId: cryptoRandomId(), reason, attempt: 0 }, "control")) log(`AUTO RE-LOCK • ${signMs(error)} • direct host output request.`);
        else { const targetAt = serverNow() + Math.max(750, Math.min(2500, 850 + state.rttMs * 4 + state.clock.jitterMs * 8)); const targetPos = authoritativeRoomPosition(targetAt); scheduleFadeResync(targetAt, targetPos, reason); }
      }
      return;
    }
    const controller = corePhaseLock?.updatePhaseLock
      ? corePhaseLock.updatePhaseLock(state.driftController, { errorMs: error, dtSec })
      : { correctionPpm: clamp(-error * 900, -20000, 20000), filteredErrorMs: error, integralMsSec: 0 };
    const correctionRate = 1 + controller.correctionPpm / 1e6;
    if (state.audioEngine === "webaudio" && state.source) {
      try { state.source.playbackRate.setTargetAtTime(correctionRate, state.audioCtx.currentTime, 0.18); } catch {}
    } else if (state.mediaEl) {
      try { state.mediaEl.playbackRate = correctionRate; } catch {}
    }
    state.lastRateCorrectionPpm = controller.correctionPpm;
    sendTelemetry("playing");
  }, 120);
}
function updatePlaybackUI() {
  if (!state.audioReady) return;
  const p = currentLocalPosition(), duration = trackDuration(); $("#pos").textContent = fmt(p); $("#dur").textContent = fmt(duration);
  if (!state._seekDrag) $("#seek").value = duration ? Math.round(clamp(p / duration, 0, 1) * 1000) : 0;
  $("#speakerNowPlaying").textContent = state.snapshot?.track ? `${state.playing ? "PLAYING" : (state.snapshot.state || "READY").toUpperCase()} • ${fmt(p)}` : "NO TRACK";
}
function setLocalGain() { if (state.gainNode && state.audioCtx) state.gainNode.gain.setTargetAtTime(state.muted ? 0 : state.volume, state.audioCtx.currentTime, 0.015); if (state.mediaEl && state.audioEngine === "media" && !state.gainNode) state.mediaEl.volume = state.muted ? 0 : state.volume; }
function applyRoomOutput(volume, muted = false) { state.volume = clamp(finite(volume, 1), 0, 1); state.muted = Boolean(muted); setLocalGain(); render(state.snapshot); }
function applyHostVolume(v) { state.volume = clamp(finite(v), 0, 1); state.muted = false; setLocalGain(); send({ type: "volume", volume: state.volume }); }
$("#masterVolume")?.addEventListener("input", e => { if (isHost()) applyHostVolume(Number(e.target.value) / 100); });
async function exportDiagnostics() {
  if (!isHost() || !state.room || !state.hostToken) return;
  try {
    const r = await fetch(`/api/room/${encodeURIComponent(state.room)}/diagnostics?format=json`, { headers: { "X-SonicSync-Host": state.hostToken } });
    if (!r.ok) throw new Error(await r.text());
    const blob = await r.blob(); const url = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`sonicsync-${state.room}-diagnostics.json`; a.click(); URL.revokeObjectURL(url);
    log("DIAGNOSTICS • JSON export created without secrets.");
  } catch(e) { log(`DIAGNOSTICS EXPORT FAILED • ${e.message}`); }
}
function cycleRepeat() { const modes=["off","all","one"]; const i=modes.indexOf(state.snapshot?.repeatMode || "off"); send({type:"queue", repeatMode:modes[(i+1)%modes.length], shuffle:Boolean(state.snapshot?.shuffle)}); }
function toggleShuffle() { send({type:"queue", repeatMode:state.snapshot?.repeatMode || "off", shuffle:!state.snapshot?.shuffle}); }

$("#muteBtn")?.addEventListener("click", () => { if (!isHost()) return; state.muted = !state.muted; setLocalGain(); send({ type: "mute", muted: state.muted }); });

$("#startBtn")?.addEventListener("click", async () => { try { await unlockAudio({ resume: true, testTone: IS_IOS }); } catch { return showEnableAudio(); } send({ type: "start", leadMs: 4000 }); });
$("#pauseBtn")?.addEventListener("click", () => send({ type: "pause" }));
$("#resumeBtn")?.addEventListener("click", async () => { try { await unlockAudio({ resume: true }); } catch { return showEnableAudio(); } send({ type: "resume", leadMs: 3000 }); });
$("#stopBtn")?.addEventListener("click", () => send({ type: "stop" }));
$("#resetBtn")?.addEventListener("click", () => send({ type: "reset" }));
$("#nextBtn")?.addEventListener("click", () => send({ type: "next" }));
$("#prevBtn")?.addEventListener("click", () => send({ type: "previous" }));
$("#shuffleBtn")?.addEventListener("click", toggleShuffle);
$("#repeatBtn")?.addEventListener("click", cycleRepeat);
$("#exportDiagnosticsBtn")?.addEventListener("click", exportDiagnostics);

$("#syncAllBtn")?.addEventListener("click", () => {
  if (!isHost() || !state.playing) return;
  send({ type: "syncAll" });
  log("SYNC ALL • requesting one authoritative future anchor from the room controller.");
});
$("#syncNowBtn")?.addEventListener("click", () => {
  if (!state.audioEnabled) return showEnableAudio();
  if (state.rtc.hostPeerId && rtcSend(state.rtc.hostPeerId, { k: "syncRequest", requestId: cryptoRandomId() }, "control")) log("SYNC TO HOST • direct peer timeline requested.");
  else { send({ type: "requestSync" }); log("SYNC TO HOST • LAN fallback requested."); }
});
$("#lockBtn")?.addEventListener("click", () => send({ type: "lockRoom", locked: $("#lockBtn").textContent === "LOCK ROOM" }));

$("#seek")?.addEventListener("input", e => { if (!isHost() || !trackDuration()) return; state._seekDrag = true; const p = (Number(e.target.value) / 1000) * trackDuration(); $("#pos").textContent = fmt(p); });
$("#seek")?.addEventListener("change", e => { if (!isHost() || !trackDuration()) return; state._seekDrag = false; const p = (Number(e.target.value) / 1000) * trackDuration(); send({ type: "seek", position: p, duration: trackDuration() }); });

async function uploadPublicTrack(file) {
  const config = await api("/api/config");
  const maxBytes = Number(config.uploadMaxBytes) || (25 * 1024 * 1024);
  if (file.size > maxBytes) throw new Error("Public beta track limit is 25 MiB. Choose a smaller MP3/WAV file.");
  if (!/\.(mp3|wav)$/i.test(file.name)) throw new Error("Public beta currently accepts MP3 and WAV files.");
  if (!crypto?.subtle) throw new Error("SHA-256 is unavailable. Open SonicSync over HTTPS.");
  $("#fileTitle").textContent = "Verifying " + file.name;
  const raw = await file.arrayBuffer();
  const digestBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  const sha256 = [...digestBytes].map(b => b.toString(16).padStart(2, "0")).join("");
  const headers = { "X-SonicSync-Room": state.room, "X-SonicSync-Host": state.hostToken, "Content-Type": "application/json" };
  const begin = await api("/api/public-upload/" + state.room + "/begin", {
    method: "POST", headers,
    body: JSON.stringify({ name: file.name, mime: /\.wav$/i.test(file.name) ? "audio/wav" : "audio/mpeg", bytes: file.size, sha256 })
  });
  const chunkSize = Number(begin.chunkSize) || 1024 * 1024, count = Number(begin.chunkCount);
  for (let index = 0; index < count; index++) {
    const start = index * chunkSize, end = Math.min(file.size, start + chunkSize), chunk = file.slice(start, end);
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch("/api/public-upload/" + state.room + "/" + begin.uploadId + "/" + index, {
          method: "PUT",
          headers: { "X-SonicSync-Room": state.room, "X-SonicSync-Host": state.hostToken, "Content-Type": "application/octet-stream" },
          body: chunk
        });
        if (!response.ok) throw new Error(await response.text() || "HTTP " + response.status);
        lastError = null; break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    if (lastError) throw lastError;
    $("#fileTitle").textContent = "Uploading " + file.name + " • " + Math.round((end / file.size) * 100) + "%";
  }
  $("#fileTitle").textContent = "Verifying uploaded media…";
  return api("/api/public-upload/" + state.room + "/" + begin.uploadId + "/complete", {
    method: "POST", headers: { "X-SonicSync-Room": state.room, "X-SonicSync-Host": state.hostToken }
  });
}
async function uploadSelected(file) {
  if (!file) return;
  $("#fileTitle").textContent = file.name;
  try {
    log("UPLOAD • " + file.name);
    const config = await api("/api/config");
    let track;
    if (config.backendMode === "public") track = await uploadPublicTrack(file);
    else track = await api("/api/upload", {
      method: "POST",
      headers: { "X-SonicSync-Room": state.room, "X-SonicSync-Host": state.hostToken },
      body: (() => { const fd = new FormData(); fd.append("audio", file); return fd; })()
    });
    state.snapshot = state.snapshot || { track: null, devices: [], ready: { total: 0, ready: 0 }, state: "ready", volume: 1, muted: false };
    state.snapshot.track = track; render(state.snapshot); await prepareTrack(track);
    log("TRACK COMMITTED • all joined nodes will preload automatically.");
  } catch (e) { log("UPLOAD FAILED • " + e.message); alert(e.message); }
}
$("#file")?.addEventListener("change", e => uploadSelected(e.target.files[0]));
const drop = $("#drop");
["dragenter", "dragover"].forEach(type => drop?.addEventListener(type, e => { e.preventDefault(); drop.classList.add("drag"); }));
["dragleave", "drop"].forEach(type => drop?.addEventListener(type, e => { e.preventDefault(); drop.classList.remove("drag"); }));
drop?.addEventListener("drop", e => uploadSelected(e.dataTransfer.files[0]));

$("#copyBtn")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(`${location.origin}/?room=${state.room}`); log("JOIN LINK COPIED"); } catch { log("COPY FAILED • browser clipboard permission denied."); } });
$("#modalCopy")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(`${location.origin}/?room=${state.room}`); log("JOIN LINK COPIED"); } catch {} });
$("#qrBtn")?.addEventListener("click", () => { $("#modalRoom").textContent = `ROOM ${state.room}`; $("#qr").src = `/api/qr/${state.room}`; $("#joinModal").classList.remove("hidden"); });
$("#closeModal")?.addEventListener("click", () => $("#joinModal").classList.add("hidden"));
$("#devices")?.addEventListener("click", e => {
  const trimButton = e.target.closest(".trim-btn");
  if (trimButton && isHost()) { const row = state.snapshot?.devices?.find(d => d.id === trimButton.dataset.client); const current = finite(row?.trimMs, 0); const next = trimButton.dataset.reset ? 0 : clamp(current + finite(trimButton.dataset.delta), -500, 500); send({ type: "trim", clientId: trimButton.dataset.client, trimMs: next }); return; }
  const kick = e.target.closest(".kick-btn"); if (kick && isHost()) send({ type: "kick", clientId: kick.dataset.kick });
});
$("#trimLess")?.addEventListener("click", () => setLocalTrim(state.trimMs - 10));
$("#trimMore")?.addEventListener("click", () => setLocalTrim(state.trimMs + 10));
$("#trimReset")?.addEventListener("click", () => setLocalTrim(0));
function setLocalTrim(value) { state.trimMs = clamp(Math.round(value / 10) * 10, -500, 500); localStorage.setItem("sonicsync.trimMs", String(state.trimMs)); updateTrimLabel(); send({ type: "trim", clientId: state.clientId, trimMs: state.trimMs }); }
function updateTrimLabel() { if ($("#trimLabel")) $("#trimLabel").textContent = `LOCAL TRIM ${state.trimMs >= 0 ? "+" : ""}${state.trimMs}ms`; }

if (!IS_IOS && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("/sw.js").catch(() => {});
updateTrimLabel();
boot();
