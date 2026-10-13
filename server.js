import express from "express";
import multer from "multer";
import QRCode from "qrcode";
import { WebSocketServer, WebSocket } from "ws";
import os from "os";
import path from "path";
import fs from "fs";
import http from "http";
import crypto from "crypto";
import { performance } from "node:perf_hooks";
import { adaptiveLeadMs as coreAdaptiveLeadMs } from "./src/core/clock.mjs";
import { positionAt as corePositionAt } from "./src/core/timeline.mjs";
import { ContentAddressedMediaStore } from "./src/core/media-store.mjs";
import { validateControlMessage } from "./src/core/protocol.mjs";

const PORT = clampInt(process.env.PORT, 8787, 1024, 65535);
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const IDLE_ROOM_TTL_MS = 20 * 60 * 1000;
const TIMELINE_PROTOCOL_VERSION = 2;
const MAX_FILE_BYTES = 120 * 1024 * 1024;
const MAX_ROOMS = 64;
const MAX_CLIENTS_PER_ROOM = 32;
const RTC_SIGNAL_MAX_BYTES = 32 * 1024;
const MAX_TRACKS_PER_ROOM_PER_HOUR = 20;
const HEARTBEAT_MS = 8_000;
const CLIENT_DEAD_MS = 24_000;
const CONTROL_MAX_BYTES = 128 * 1024;
const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;
const DATA = path.join(process.cwd(), "data");
const MEDIA_DIR = path.join(DATA, "media");
const PUBLIC = path.join(process.cwd(), "public");
const PERSIST_PATH = path.join(DATA, "rooms.json");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });
const mediaStore = new ContentAddressedMediaStore(MEDIA_DIR);

// Epoch-anchored monotonic clock. Clients learn this clock through NTP-style probes.
const SERVER_TIME_ORIGIN = performance.timeOrigin;
function now() { return SERVER_TIME_ORIGIN + performance.now(); }

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "autoplay=(self), camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; worker-src 'self' blob:");
  next();
});
app.use(express.json({ limit: "128kb" }));
app.use(express.static(PUBLIC, { extensions: ["html"] }));

const upload = multer({
  dest: DATA,
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowed = new Set([".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac", ".webm"]);
    cb(null, allowed.has(ext) || /^audio\//i.test(file.mimetype || ""));
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: CONTROL_MAX_BYTES });
const rooms = new Map();
const rateBuckets = new Map();
let bonjour = null;
const bonjourServices = new Map();
let persistTimer = null;
let nextPersistAt = 0;

try {
  const mod = await import("bonjour-service");
  const BonjourCtor = mod.Bonjour ?? mod.default;
  if (BonjourCtor) bonjour = new BonjourCtor();
} catch (e) {
  console.warn("Bonjour discovery disabled:", e?.message || e);
}

function clampInt(v, fallback, min, max) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
function finite(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function finiteClamp(v, min, max, fallback = 0) { return Math.min(max, Math.max(min, finite(v, fallback))); }
function round(v, p = 1) { const n = finite(v); const k = 10 ** p; return Math.round(n * k) / k; }
function safeText(v, max = 64) { return String(v ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max); }
function validRoomId(v) { return ROOM_CODE_RE.test(String(v || "").toUpperCase()); }
function randomCode() { let id; do id = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase(); while (rooms.has(id)); return id; }
function randomToken(bytes = 24) { return crypto.randomBytes(bytes).toString("base64url"); }
function isWsOpen(ws) { return ws?.readyState === WebSocket.OPEN; }
function wirePayload(payload) {
  if (!payload || typeof payload !== "object" || !payload.type) return payload;
  return {
    protocolVersion: TIMELINE_PROTOCOL_VERSION,
    messageId: payload.messageId || crypto.randomUUID(),
    timestamp: now(),
    ...payload
  };
}
function send(client, payload) { if (client && isWsOpen(client.ws)) client.ws.send(JSON.stringify(wirePayload(payload))); }
function broadcast(room, payload, exceptId = null) {
  const raw = JSON.stringify(wirePayload(payload));
  for (const c of room.clients.values()) if (c.id !== exceptId && isWsOpen(c.ws)) c.ws.send(raw);
}
function bump(room, timelineChange = false) { room.revision += 1; if (timelineChange) room.timelineEpoch = (room.timelineEpoch || 0) + 1; return room.revision; }
function localIPv4Candidates() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) for (const n of entries || []) {
    if (n.family === "IPv4" && !n.internal && !n.address.startsWith("127.") && !out.includes(n.address)) out.push(n.address);
  }
  return out.length ? out : ["localhost"];
}
function localIPv4() { return localIPv4Candidates()[0]; }
function hostName() { return safeText(os.hostname(), 64) || "sonicsync-host"; }
function mediaPath(room, token) { return `/media/${encodeURIComponent(room.id)}/${encodeURIComponent(token)}`; }
function clientIp(req) { return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim(); }
function socketIp(ws) { return String(ws?._socket?.remoteAddress || "unknown"); }
function allowRate(key, max, windowMs) {
  const t = now();
  const arr = rateBuckets.get(key) || [];
  const fresh = arr.filter(x => t - x < windowMs);
  if (fresh.length >= max) { rateBuckets.set(key, fresh); return false; }
  fresh.push(t); rateBuckets.set(key, fresh); return true;
}
function isPrivateLANAddress(ip) { return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(ip); }
function persistableRoom(room) {
  return {
    id: room.id, hostToken: room.hostToken, createdAt: room.createdAt, lastActivity: room.lastActivity,
    hostId: null, track: room.track ? { ...room.track } : null, queue: room.queue || [], queueIndex: room.queueIndex || 0, trackGeneration: room.trackGeneration || 0, repeatMode: room.repeatMode || "off", shuffle: Boolean(room.shuffle), state: room.state, position: room.position,
    startAt: room.startAt, startedAt: room.startedAt, pauseAt: null, pausePosition: null, stopAt: null,
    stopPosition: null, volume: room.volume, muted: room.muted, syncLeadMs: room.syncLeadMs,
    roomLocked: room.roomLocked, revision: room.revision, timelineEpoch: room.timelineEpoch || 0, trackUploads: room.trackUploads || [], pendingSeek: null,
    nextSnapshotAt: now() + 500
  };
}
function persistRooms() {
  try {
    const payload = JSON.stringify({ version: 1, rooms: [...rooms.values()].map(persistableRoom) }, null, 2);
    const tmp = `${PERSIST_PATH}.tmp`;
    fs.writeFileSync(tmp, payload, "utf8");
    fs.renameSync(tmp, PERSIST_PATH);
    try { fs.chmodSync(PERSIST_PATH, 0o600); } catch {}
  } catch (e) { console.warn("Room persistence failed:", e?.message || e); }
}
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => { persistTimer = null; persistRooms(); }, 250);
}
function loadPersistedRooms() {
  try {
    if (!fs.existsSync(PERSIST_PATH)) return;
    const data = JSON.parse(fs.readFileSync(PERSIST_PATH, "utf8"));
    if (data?.version !== 1 || !Array.isArray(data.rooms)) return;
    const t = now();
    for (const saved of data.rooms) {
      if (!saved?.id || !validRoomId(saved.id) || rooms.has(saved.id)) continue;
      if (t - finite(saved.createdAt, t) > ROOM_TTL_MS) continue;
      const track = saved.track && saved.track.filePath && fs.existsSync(saved.track.filePath) ? saved.track : null;
      rooms.set(saved.id, {
        ...saved, id: saved.id.toUpperCase(), clients: new Map(), hostId: null, startPosition: Math.max(0, finite(saved.startPosition, finite(saved.position, 0))), timelineEpoch: Math.max(0, Math.floor(finite(saved.timelineEpoch, 0))),
        track, queue: Array.isArray(saved.queue) ? saved.queue.filter(Boolean) : (track ? [track] : []), queueIndex: Math.max(0, Math.min((Array.isArray(saved.queue) ? saved.queue.length : (track ? 1 : 0)) - 1, Math.floor(finite(saved.queueIndex, 0)))), trackGeneration: Math.max(0, Math.floor(finite(saved.trackGeneration, 0))), repeatMode: ["off","one","all"].includes(saved.repeatMode) ? saved.repeatMode : "off", shuffle: Boolean(saved.shuffle), state: track && ["playing", "armed", "paused", "stopped", "ready"].includes(saved.state) ? (saved.state === "playing" ? "stopped" : saved.state) : "idle",
        startAt: null, startedAt: null, pauseAt: null, pausePosition: null, stopAt: null, stopPosition: null,
        pendingSeek: null, nextSnapshotAt: t + 500
      });
      publishDiscovery(rooms.get(saved.id));
    }
    if (rooms.size) console.log(`Restored ${rooms.size} persisted room(s).`);
  } catch (e) { console.warn("Room restore skipped:", e?.message || e); }
}
function roomFor(id) { return rooms.get(String(id || "").toUpperCase()); }

function publicTrack(track) {
  if (!track) return null;
  const { filePath, ...safe } = track;
  return safe;
}
function timelinePosition(room, at = now()) {
  return corePositionAt({
    trackId: room.track?.id || null, state: room.state, startedAt: room.startedAt,
    anchorPosition: finite(room.position, 0), position: finite(room.position, 0), rate: 1
  }, at);
}
function authoritativeAudioPosition(room, at = now()) {
  const base = timelinePosition(room, at);
  const host = room.hostId ? room.clients.get(room.hostId) : null;
  const bias = host && room.state === "playing" ? finiteClamp(host.info.hostAudioBiasMs, -120, 120, 0) : 0;
  return Math.max(0, base + bias / 1000);
}
function adaptiveLeadMs(room, client = null, floor = 1300, ceiling = 6000) {
  const nodes = client ? [client] : [...room.clients.values()];
  const rtts = nodes.map(c => finite(c.info.rttMs, 0)).filter(v => v > 0);
  const jitters = nodes.map(c => finite(c.info.clockJitterMs, 0)).filter(v => v > 0);
  const uncertainties = nodes.map(c => finite(c.info.clockUncertaintyMs, 0)).filter(v => v > 0);
  const reliability = nodes.length ? Math.max(0.35, nodes.reduce((sum, c) => sum + (c.info.syncConfidence || 0.8), 0) / nodes.length) : 1;
  return coreAdaptiveLeadMs({
    rttMs: rtts.length ? Math.max(...rtts) : 20,
    jitterMs: jitters.length ? Math.max(...jitters) : 5,
    uncertaintyMs: uncertainties.length ? Math.max(...uncertainties) : 3,
    reliability, floor, ceiling
  });
}
function mediaHeaders(filePath, preferredMime = "") {
  if (/^audio\/[a-z0-9.+-]+$/i.test(preferredMime)) return preferredMime;
  const ext = path.extname(filePath).toLowerCase();
  const mime = ({
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
    ".aac": "audio/aac", ".flac": "audio/flac", ".webm": "audio/webm"
  })[ext] || "application/octet-stream";
  return mime;
}
function roomReadySummary(room) {
  const nodes = [...room.clients.values()];
  const total = nodes.length;
  const trackId = room.track?.id;
  const prepared = trackId ? nodes.filter(c => c.readyTrackId === trackId && c.info.audioReady).length : 0;
  const enabled = trackId ? nodes.filter(c => c.readyTrackId === trackId && c.info.audioReady && c.info.audioEnabled).length : 0;
  const clockReady = trackId ? nodes.filter(c => c.readyTrackId === trackId && c.info.audioReady && c.info.clockSampleCount >= 3).length : 0;
  const clockLocked = trackId ? nodes.filter(c => c.readyTrackId === trackId && c.info.audioReady && c.info.clockLocked).length : 0;
  return { total, prepared, enabled, clockReady, clockLocked, ready: enabled };
}
function roomSnapshot(room) {
  const t = now();
  const nodes = [...room.clients.values()];
  const ready = roomReadySummary(room);
  return {
    id: room.id,
    revision: room.revision,
    createdAt: room.createdAt,
    hostId: room.hostId,
    track: publicTrack(room.track),
    state: room.state,
    position: timelinePosition(room, t),
    masterAudioPosition: authoritativeAudioPosition(room, t),
    authoritativeAudioBiasMs: round(room.hostId ? finite(room.clients.get(room.hostId)?.info.hostAudioBiasMs, 0) : 0),
    startedAt: room.startedAt,
    startAt: room.startAt,
    timelineEpoch: room.timelineEpoch || 0,
    pauseAt: room.pauseAt,
    stopAt: room.stopAt,
    volume: room.volume,
    muted: room.muted,
    syncLeadMs: room.syncLeadMs,
    queue: (room.queue || []).map(publicTrack),
    queueIndex: room.queueIndex || 0,
    trackGeneration: room.trackGeneration || 0,
    repeatMode: room.repeatMode || "off",
    shuffle: Boolean(room.shuffle),
    roomLocked: room.roomLocked,
    serverNow: t,
    ready,
    devices: nodes.map(c => ({
      id: c.id,
      name: c.info.name,
      role: c.info.role,
      joinedAt: c.info.joinedAt,
      offsetMs: round(c.info.offsetMs),
      clockDriftPpm: round(c.info.clockDriftPpm, 1),
      clockJitterMs: round(c.info.clockJitterMs),
      clockUncertaintyMs: round(c.info.clockUncertaintyMs),
      syncConfidence: round(c.info.syncConfidence, 3),
      rttMs: round(c.info.rttMs),
      syncErrorMs: round(c.info.syncErrorMs),
      outputLatencyMs: round(c.info.outputLatencyMs),
      baseLatencyMs: round(c.info.baseLatencyMs),
      trimMs: round(c.info.trimMs),
      volume: round(c.info.volume, 3),
      bufferSec: round(c.info.bufferSec, 1),
      status: c.info.status,
      transport: c.info.transport,
      rtcState: c.info.rtcState,
      clockLocked: Boolean(c.info.clockLocked),
      clockSampleCount: Number(c.info.clockSampleCount || 0),
      audioReady: Boolean(c.info.audioReady),
      audioEnabled: Boolean(c.info.audioEnabled),
      lastSyncAt: c.info.lastSyncAt || null,
      lastSyncErrorMs: round(c.info.lastSyncErrorMs),
      rateCorrectionPpm: round(c.info.rateCorrectionPpm),
      lastSeen: c.info.lastSeen
    }))
  };
}
function broadcastSnapshot(room) { broadcast(room, { type: "snapshot", revision: room.revision, snapshot: roomSnapshot(room) }); }
function removeRoom(room) {
  const service = bonjourServices.get(room.id);
  if (service) { try { service.stop?.(); } catch {} bonjourServices.delete(room.id); }
  for (const c of room.clients.values()) { try { c.ws.close(1001, "Room closed"); } catch {} }
  // Content-addressed media is shared safely across rooms; cleanup is handled by future GC, not room teardown.
  rooms.delete(room.id);
  schedulePersist();
}
function publishDiscovery(room) {
  if (!bonjour) return;
  try {
    const service = bonjour.publish({ name: `SonicSync-${room.id}`, type: "sonicsync", port: PORT, txt: { v: "10", room: room.id, protocol: String(TIMELINE_PROTOCOL_VERSION) } });
    bonjourServices.set(room.id, service);
  } catch (e) { console.warn(`Bonjour publish failed for ${room.id}:`, e?.message || e); }
}
function hostAuthorized(room, m) { return m?.hostToken && m.hostToken === room.hostToken; }

app.get("/api/config", (req, res) => res.json({
  version: "10.0.2",
  port: PORT,
  lanIP: localIPv4(),
  lanIPs: localIPv4Candidates().filter(isPrivateLANAddress),
  hostname: hostName(),
  joinBase: `http://${localIPv4()}:${PORT}`,
  noInternetRequired: true,
  nearbyDiscovery: Boolean(bonjour),
  protocolVersion: TIMELINE_PROTOCOL_VERSION,
  transport: "local LAN/hotspot preload + WebSocket signaling/control + WebRTC direct sync + local audio playback",
  browserMode: "No cloud media path. Internet is not required."
}));
app.get("/api/time", (req, res) => res.json({ now: now() }));
app.get("/api/health", (req, res) => res.json({ status: "ok", version: "10.0.2", rooms: rooms.size, now: now(), discovery: Boolean(bonjour) }));

app.get("/api/room/:room/diagnostics", (req, res) => {
  const room = roomFor(req.params.room);
  const hostToken = String(req.headers["x-sonicsync-host"] || "");
  if (!room || !hostAuthorized(room, { hostToken })) return res.status(403).json({ error: "Invalid host authorization." });
  const snapshot = roomSnapshot(room);
  const payload = { exportedAt: now(), protocolVersion: TIMELINE_PROTOCOL_VERSION, room: snapshot, limitations: ["Software telemetry is not acoustic measurement.", "Output and acoustic latency require physical instrumentation."] };
  if (String(req.query.format).toLowerCase() === "csv") {
    const cols = ["id","name","role","transport","rttMs","clockJitterMs","clockUncertaintyMs","clockDriftPpm","syncErrorMs","outputLatencyMs","trimMs","bufferSec","syncConfidence","status"];
    const csv = [cols.join(","), ...snapshot.devices.map(d => cols.map(k => JSON.stringify(d[k] ?? "")).join(","))].join("\n");
    res.type("text/csv").setHeader("Content-Disposition", `attachment; filename="sonicsync-${room.id}-diagnostics.csv"`).send(csv);
    return;
  }
  res.type("application/json").setHeader("Content-Disposition", `attachment; filename="sonicsync-${room.id}-diagnostics.json"`).send(JSON.stringify(payload, null, 2));
});

app.post("/api/room", (req, res) => {
  if (!allowRate(`room:${clientIp(req)}`, 8, 60_000)) return res.status(429).json({ error: "Too many room requests. Try again in a minute." });
  if (rooms.size >= MAX_ROOMS) return res.status(503).json({ error: "Room capacity reached." });
  const id = randomCode();
  const room = {
    id,
    hostToken: randomToken(),
    createdAt: now(),
    lastActivity: now(),
    clients: new Map(),
    hostId: null,
    track: null,
    state: "idle",
    position: 0,
    startAt: null,
    startedAt: null,
    pauseAt: null,
    pausePosition: null,
    stopAt: null,
    stopPosition: null,
    volume: 1,
    muted: false,
    syncLeadMs: 3000,
    roomLocked: false,
    revision: 0,
    timelineEpoch: 0,
    trackUploads: [],
    queue: [],
    queueIndex: 0,
    startPosition: 0,
    trackGeneration: 0,
    repeatMode: "off",
    shuffle: false,
    pendingSeek: null,
    nextSnapshotAt: now() + 150
  };
  rooms.set(id, room);
  publishDiscovery(room);
  schedulePersist();
  res.json({ id, hostToken: room.hostToken, joinBase: `http://${localIPv4()}:${PORT}`, hostname: hostName(), discoveryService: `SonicSync-${id}._sonicsync._tcp.local` });
});

function activateQueuedTrack(room, index, { reason = "queue" } = {}) {
  const queue = Array.isArray(room.queue) ? room.queue : [];
  if (!queue.length) return false;
  const nextIndex = Math.max(0, Math.min(queue.length - 1, index));
  const next = queue[nextIndex];
  room.queueIndex = nextIndex;
  room.trackGeneration = (room.trackGeneration || 0) + 1;
  room.track = next;
  room.state = "ready";
  room.position = 0;
  room.startPosition = 0;
  room.startAt = room.startedAt = room.pauseAt = room.stopAt = null;
  room.pausePosition = room.stopPosition = null;
  room.pendingSeek = null;
  for (const c of room.clients.values()) {
    c.readyTrackId = null;
    c.info.audioReady = false; c.info.audioEnabled = false; c.info.clockLocked = false;
    c.info.clockSampleCount = 0; c.info.bufferSec = 0; c.info.syncErrorMs = 0; c.info.status = "preparing";
  }
  const rev = bump(room, true);
  broadcast(room, { type: "trackOffer", revision: rev, timelineEpoch: room.timelineEpoch, trackGeneration: room.trackGeneration, track: publicTrack(next), reason });
  broadcastSnapshot(room);
  schedulePersist();
  return true;
}

app.post("/api/upload", (req, res) => {
  const roomId = String(req.headers["x-sonicsync-room"] || "").toUpperCase();
  const token = String(req.headers["x-sonicsync-host"] || "");
  const room = roomFor(roomId);
  if (!room || !hostAuthorized(room, { hostToken: token })) return res.status(403).json({ error: "Invalid host authorization." });
  if (!allowRate(`upload:${roomId}:${clientIp(req)}`, 12, 5 * 60_000)) return res.status(429).json({ error: "Upload rate limit reached." });
  room.trackUploads = room.trackUploads.filter(t => now() - t < 60 * 60_000);
  if (room.trackUploads.length >= MAX_TRACKS_PER_ROOM_PER_HOUR) return res.status(429).json({ error: "Track upload limit reached for this room." });

  upload.single("audio")(req, res, async err => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Audio file is too large (120 MB max)." : err.message });
    if (!req.file) return res.status(400).json({ error: "No audio file selected." });
    let finalPath = null;
    try {
      const original = safeText(req.file.originalname || "track", 140) || "track";
      const ext = path.extname(original).toLowerCase() || ".bin";
      const tokenId = randomToken(18);
      const hash = crypto.createHash("sha256");
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(req.file.path);
        rs.on("data", chunk => hash.update(chunk));
        rs.on("end", resolve);
        rs.on("error", reject);
      });
      const sha256 = hash.digest("hex");
      finalPath = mediaStore.putFile(req.file.path, sha256);
      const bytes = fs.statSync(finalPath).size;
      const track = { id: sha256, url: mediaPath(room, tokenId), token: tokenId, name: original, mime: req.file.mimetype || mediaHeaders(original), bytes, sha256, filePath: finalPath, durationSec: null };
      room.queue = Array.isArray(room.queue) ? room.queue : [];
      const duplicate = room.queue.find(t => t.sha256 === sha256);
      if (duplicate) {
        track.name = duplicate.name || original;
        track.durationSec = duplicate.durationSec ?? null;
      }
      room.queue.push(track);
      room.queueIndex = room.queue.length - 1;
      room.trackGeneration = (room.trackGeneration || 0) + 1;
      if (room.track?.filePath && room.track.filePath !== finalPath) { /* content-addressed objects are retained until safe GC */ }
      room.track = track;
      room.state = "ready";
      room.position = 0;
      room.startPosition = 0;
      room.startAt = room.startedAt = room.pauseAt = room.stopAt = null;
      room.pausePosition = room.stopPosition = null;
      room.pendingSeek = null;
      room.trackUploads.push(now());
      for (const c of room.clients.values()) {
        c.readyTrackId = null;
        c.info.audioReady = false;
        c.info.audioEnabled = false;
        c.info.clockLocked = false;
        c.info.clockSampleCount = 0;
        c.info.bufferSec = 0;
        c.info.syncErrorMs = 0;
        c.info.status = "preparing";
      }
      bump(room, true);
      broadcast(room, { type: "trackOffer", revision: room.revision, timelineEpoch: room.timelineEpoch, trackGeneration: room.trackGeneration, track: publicTrack(track), queueIndex: room.queueIndex, queueLength: room.queue.length });
      broadcastSnapshot(room);
      schedulePersist();
      res.json(publicTrack(track));
    } catch {
      try { if (req.file?.path && fs.existsSync(req.file.path)) fs.rmSync(req.file.path, { force: true }); } catch {}
      res.status(500).json({ error: "Upload processing failed." });
    }
  });
});

app.get("/media/:room/:token", (req, res) => {
  const room = roomFor(req.params.room);
  const token = String(req.params.token || "");
  const track = room?.track;
  if (!track || track.token !== token || !track.filePath) return res.status(404).end();
  let st;
  try { st = fs.statSync(track.filePath); } catch { return res.status(404).end(); }
  const mime = mediaHeaders(track.filePath, track.mime);
  const size = st.size;
  res.setHeader("Content-Type", mime);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600, immutable");
  res.setHeader("Content-Length", size);
  room.lastActivity = now();
  if (req.method === "HEAD") return res.end();
  const range = req.headers.range;
  if (!range) return fs.createReadStream(track.filePath).pipe(res);
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(range));
  if (!match) { res.status(416).setHeader("Content-Range", `bytes */${size}`); return res.end(); }
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2] || 0);
    if (!Number.isInteger(suffix) || suffix <= 0) { res.status(416).setHeader("Content-Range", `bytes */${size}`); return res.end(); }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) { res.status(416).setHeader("Content-Range", `bytes */${size}`); return res.end(); }
  end = Math.min(end, size - 1);
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  res.setHeader("Content-Length", end - start + 1);
  fs.createReadStream(track.filePath, { start, end }).pipe(res);
});
app.head("/media/:room/:token", (req, res) => res.status(405).end());

app.get("/api/qr/:room", async (req, res) => {
  const room = roomFor(req.params.room);
  if (!room) return res.status(404).end();
  const ip = localIPv4();
  const url = `http://${ip}:${PORT}/?room=${encodeURIComponent(room.id)}`;
  try { res.type("png").send(await QRCode.toBuffer(url, { width: 512, margin: 2, errorCorrectionLevel: "M" })); }
  catch { res.status(500).end(); }
});

wss.on("connection", ws => {
  const ip = socketIp(ws);
  let client = null;
  if (!allowRate(`ws:${ip}`, 60, 60_000)) { try { ws.close(4029, "Connection rate limited"); } catch {} return; }
  const heartbeatTimer = setInterval(() => { if (isWsOpen(ws)) { try { ws.ping(); } catch {} } }, HEARTBEAT_MS);
  ws.on("pong", () => { if (client) client.info.lastSeen = now(); });

  ws.on("message", raw => {
    if (raw.length > CONTROL_MAX_BYTES) return send(client || { ws }, { type: "error", message: "Control packet is too large." });
    const checked = validateControlMessage(raw.toString("utf8"), { maxBytes: CONTROL_MAX_BYTES });
    if (!checked.ok) return send(client || { ws }, { type: "error", message: `Invalid control packet: ${checked.error}.` });
    const m = checked.message;

    if (!client && m.type === "join") {
      if (!allowRate(`join:${ip}`, 20, 60_000)) return send({ ws }, { type: "error", message: "Too many join attempts. Try again shortly." });
      const room = roomFor(m.room);
      if (!room || !validRoomId(room.id)) return send({ ws }, { type: "error", message: "Room not found or expired." });
      const requestedRole = m.role === "host" ? "host" : "client";
      const authHost = requestedRole === "host" && hostAuthorized(room, m);
      if (requestedRole === "host" && !authHost) return send({ ws }, { type: "error", message: "Host authorization failed." });
      if (room.roomLocked && !authHost) return send({ ws }, { type: "error", message: "This room is locked." });
      if (room.clients.size >= MAX_CLIENTS_PER_ROOM && !authHost) return send({ ws }, { type: "error", message: "Room is full." });

      if (authHost && room.hostId) {
        const previous = room.clients.get(room.hostId);
        if (previous && previous.ws !== ws) {
          try { previous.ws.close(4001, "Host reconnected"); } catch {}
          room.clients.delete(previous.id);
        }
        room.hostId = null;
      }

      const id = crypto.randomBytes(6).toString("hex");
      const role = authHost ? "host" : "client";
      client = {
        ws, id, room, role, readyTrackId: null,
        info: {
          name: safeText(m.name || (role === "host" ? "Host" : "Speaker"), 32) || "Speaker",
          role, joinedAt: now(), offsetMs: 0, clockDriftPpm: 0, clockJitterMs: 0, rttMs: 0,
          syncErrorMs: 0, hostAudioBiasMs: 0, outputLatencyMs: 0, baseLatencyMs: 0, clockUncertaintyMs: 0, syncConfidence: 0, rateCorrectionPpm: 0,
          clockLocked: false, clockSampleCount: 0, audioReady: false, audioEnabled: false,
          trimMs: 0, volume: room.muted ? 0 : room.volume, bufferSec: 0, status: "connected",
          transport: "LAN / WS", rtcState: "disconnected", lastSeen: now(), lastSyncAt: null, lastSyncErrorMs: 0, syncFailures: 0, durationSec: 0
        }
      };
      room.clients.set(id, client);
      if (role === "host") room.hostId = id;
      room.lastActivity = now();
      send(client, { type: "welcome", revision: room.revision, clientId: id, role, serverNow: now(), snapshot: roomSnapshot(room) });
      if (room.track) send(client, { type: "trackOffer", revision: room.revision, timelineEpoch: room.timelineEpoch, trackGeneration: room.trackGeneration, track: publicTrack(room.track) });
      if (room.state === "armed" && room.startAt != null) {
        const p = timelinePosition(room, now());
        send(client, { type: "schedule", revision: room.revision, effectiveAt: room.startAt, position: p, commandId: `start-${room.revision}` });
      } else if (room.state === "playing" && room.startedAt != null) {
        const lead = adaptiveLeadMs(room, client, 1100, 5000);
        const effectiveAt = now() + lead;
        send(client, { type: "syncNow", revision: room.revision, effectiveAt, position: authoritativeAudioPosition(room, effectiveAt), reason: "late-join", commandId: `late-${room.revision}` });
      } else if (room.state === "paused" || room.state === "stopped") {
        send(client, { type: "position", revision: room.revision, position: room.position, state: room.state });
      }

      // Direct peer sync: the host is authoritative. WebSocket only carries signaling.
      if (role === "host") {
        for (const peer of room.clients.values()) {
          if (peer.id !== client.id && peer.role !== "host") {
            send(client, { type: "rtcPeerJoin", peerId: peer.id, name: peer.info.name });
            send(peer, { type: "rtcHostAvailable", hostId: client.id });
          }
        }
      } else if (room.hostId && room.hostId !== client.id) {
        const host = room.clients.get(room.hostId);
        if (host) send(host, { type: "rtcPeerJoin", peerId: client.id, name: client.info.name });
      }
      bump(room);
      broadcastSnapshot(room);
      return;
    }

    if (!client) return;
    const room = client.room;
    client.info.lastSeen = now();
    room.lastActivity = now();

    if (m.type === "rtcSignal") {
      const targetId = safeText(m.targetClientId || "", 64);
      const target = room.clients.get(targetId);
      const payload = m.payload;
      if (!target || target.id === client.id || payload == null) return;
      let encoded; try { encoded = JSON.stringify(payload); } catch { return; }
      if (Buffer.byteLength(encoded, "utf8") > RTC_SIGNAL_MAX_BYTES) return send(client, { type: "error", message: "RTC signaling packet too large." });
      send(target, { type: "rtcSignal", fromClientId: client.id, payload });
      return;
    }

    if (m.type === "rtcState") {
      client.info.rtcState = ["new", "connecting", "connected", "disconnected", "failed", "closed"].includes(m.state) ? m.state : "disconnected";
      client.info.transport = client.info.rtcState === "connected" ? "RTC-P2P" : "LAN / WS";
      return;
    }

    if (m.type === "sync") {
      const t1 = finite(m.t1, NaN);
      if (!Number.isFinite(t1)) return;
      const t2 = now(); const t3 = now();
      return send(client, { type: "syncReply", seq: m.seq, t1, t2, t3 });
    }

    if (m.type === "telemetry") {
      const oldBias = finite(client.info.hostAudioBiasMs, 0);
      client.info.offsetMs = finiteClamp(m.offsetMs, -120_000, 120_000, 0);
      client.info.clockDriftPpm = finiteClamp(m.clockDriftPpm, -1000, 1000, 0);
      client.info.clockJitterMs = finiteClamp(m.clockJitterMs, 0, 500, 0);
      client.info.clockLocked = Boolean(m.clockLocked);
      client.info.clockSampleCount = Math.max(0, Math.min(1000, Math.floor(finite(m.clockSampleCount, 0))));
      client.info.audioReady = Boolean(m.audioReady);
      client.info.audioEnabled = Boolean(m.audioEnabled);
      client.info.rttMs = finiteClamp(m.rttMs, 0, 10_000, 0);
      client.info.syncErrorMs = finiteClamp(m.syncErrorMs, -10_000, 10_000, 0);
      client.info.lastSyncErrorMs = finiteClamp(m.lastSyncErrorMs, -5000, 5000, 0);
      client.info.rateCorrectionPpm = finiteClamp(m.rateCorrectionPpm, -20000, 20000, 0);
      client.info.outputLatencyMs = finiteClamp(m.outputLatencyMs, 0, 5000, 0);
      client.info.baseLatencyMs = finiteClamp(m.baseLatencyMs, 0, 5000, 0);
      client.info.bufferSec = finiteClamp(m.bufferSec, 0, 3600, 0);
      client.info.durationSec = finiteClamp(m.durationSec, 0, 24 * 3600, 0);
      if (room.track && client.info.durationSec > 0 && !room.track.durationSec) room.track.durationSec = client.info.durationSec;
      client.info.status = ["connected", "preparing", "ready", "clock-sync", "audio-gesture", "scheduled", "playing", "paused", "stopped", "error", "syncing"].includes(m.status) ? m.status : "connected";
      client.info.lastSeen = now();
      client.info.transport = safeText(m.transport || "LAN", 16);
      if (client.role === "host" && room.state === "playing" && Math.abs(client.info.syncErrorMs) < 120) {
        client.info.hostAudioBiasMs = oldBias * 0.85 + client.info.syncErrorMs * 0.15;
      }
      return;
    }

    if (m.type === "ready") {
      if (!room.track || m.trackId !== room.track.id) return;
      client.readyTrackId = room.track.id;
      client.info.audioReady = Boolean(m.audioReady);
      client.info.audioEnabled = Boolean(m.audioEnabled);
      client.info.clockLocked = Boolean(m.clockLocked);
      client.info.clockSampleCount = Math.max(0, Math.min(1000, Math.floor(finite(m.clockSampleCount, 0))));
      client.info.bufferSec = finiteClamp(m.bufferSec, 0, 3600, 0);
      client.info.durationSec = finiteClamp(m.durationSec, 0, 24 * 3600, 0);
      if (room.track && client.info.durationSec > 0 && !room.track.durationSec) room.track.durationSec = client.info.durationSec;
      client.info.outputLatencyMs = finiteClamp(m.outputLatencyMs, 0, 5000, 0);
      client.info.baseLatencyMs = finiteClamp(m.baseLatencyMs, 0, 5000, 0);
      client.info.status = client.info.audioReady ? (client.info.audioEnabled ? (client.info.clockLocked ? "ready" : "clock-sync") : "audio-gesture") : "preparing";
      send(client, { type: "readyAck", revision: room.revision, trackId: room.track.id });
      if (room.state === "armed" && room.startAt != null && client.info.audioReady && client.info.audioEnabled) {
        const p = timelinePosition(room, now());
        send(client, { type: "schedule", revision: room.revision, effectiveAt: room.startAt, position: p, commandId: `start-${room.revision}` });
      }
      if (room.state === "playing" && room.startedAt != null && client.info.audioReady && client.info.audioEnabled) {
        const lead = adaptiveLeadMs(room, client, 1100, 5000);
        const effectiveAt = now() + lead;
        send(client, { type: "syncNow", revision: room.revision, effectiveAt, position: authoritativeAudioPosition(room, effectiveAt), reason: "ready-while-playing", commandId: `ready-${room.revision}-${client.id}` });
      }
      broadcastSnapshot(room);
      return;
    }

    if (m.type === "requestSync") {
      if (room.state === "playing" && room.startedAt != null) {
        const lead = adaptiveLeadMs(room, client, 1200, 6500);
        const effectiveAt = now() + lead;
        client.info.lastSyncAt = now();
        client.info.syncFailures = 0;
        return send(client, { type: "syncNow", revision: room.revision, effectiveAt, position: authoritativeAudioPosition(room, effectiveAt), reason: "manual", commandId: `manual-${room.revision}-${Date.now()}` });
      }
      if (["paused", "stopped", "ready"].includes(room.state)) return send(client, { type: "position", revision: room.revision, position: room.position, state: room.state });
      return send(client, { type: "syncIdle", revision: room.revision });
    }

    if (m.type === "syncMismatch") {
      if (room.state !== "playing" || room.startedAt == null) return;
      const error = finiteClamp(m.errorMs, -5000, 5000, 0);
      client.info.lastSyncErrorMs = error;
      if (Math.abs(error) <= 12 || client.info.syncFailures >= 2) return;
      client.info.syncFailures += 1;
      const lead = adaptiveLeadMs(room, client, 1600 + client.info.syncFailures * 500, 7000);
      const effectiveAt = now() + lead;
      return send(client, { type: "syncNow", revision: room.revision, effectiveAt, position: authoritativeAudioPosition(room, effectiveAt), reason: "auto-retry", commandId: `retry-${room.revision}-${client.info.syncFailures}` });
    }

    if (m.type === "syncApplied") {
      client.info.lastSyncAt = now();
      client.info.lastSyncErrorMs = finiteClamp(m.errorMs, -5000, 5000, 0);
      return;
    }

    if (client.role !== "host") return;

    if (m.type === "start") {
      if (!room.track) return send(client, { type: "error", message: "Load a track first." });
      const { prepared, enabled, clockReady, total } = roomReadySummary(room);
      if (!total || prepared < total || clockReady < total) return send(client, { type: "error", message: `Playback locked: ${prepared}/${total} decoded, ${clockReady}/${total} clock-locked. Speaker audio gates may remain pending and will catch up after local activation.` });
      if (!isWsOpen(client.ws) || !client.info.audioEnabled) return send(client, { type: "error", message: "Host speaker is not enabled." });
      const lead = finiteClamp(m.leadMs, adaptiveLeadMs(room, null, 2800, 7000), 2000, 10_000);
      room.syncLeadMs = lead;
      room.position = 0;
      room.startPosition = 0;
      room.startAt = now() + lead;
      room.startedAt = null;
      room.pauseAt = room.stopAt = null;
      room.state = "armed";
      room.pendingSeek = null;
      const rev = bump(room, true);
      broadcast(room, { type: "schedule", revision: rev, timelineEpoch: room.timelineEpoch, effectiveAt: room.startAt, position: 0, commandId: `start-${rev}` });
      broadcastSnapshot(room);
      return;
    }

    if (m.type === "pause") {
      if (room.state !== "playing" || room.startedAt == null) return;
      const effectiveAt = now() + adaptiveLeadMs(room, null, 400, 1800);
      const position = authoritativeAudioPosition(room, effectiveAt);
      room.state = "pausing"; room.pauseAt = effectiveAt; room.pausePosition = position; room.pendingSeek = null;
      const rev = bump(room, true);
      broadcast(room, { type: "pauseScheduled", revision: rev, timelineEpoch: room.timelineEpoch, effectiveAt, position, commandId: `pause-${rev}` });
      broadcastSnapshot(room);
      return;
    }

    if (m.type === "resume") {
      if (!room.track || !["paused", "stopped"].includes(room.state)) return;
      const { prepared, enabled, clockReady, total } = roomReadySummary(room);
      if (prepared < total || clockReady < total) return send(client, { type: "error", message: `Resume locked: ${prepared}/${total} decoded, ${clockReady}/${total} clock-locked. Speaker audio gates may remain pending and will catch up after local activation.` });
      const lead = finiteClamp(m.leadMs, adaptiveLeadMs(room, null, 2200, 6500), 1200, 9000);
      room.startPosition = Math.max(0, finite(room.position, 0));
      room.startAt = now() + lead;
      room.syncLeadMs = lead;
      room.startedAt = null;
      room.pauseAt = room.stopAt = null;
      room.state = "armed";
      room.pendingSeek = null;
      const rev = bump(room, true);
      broadcast(room, { type: "schedule", revision: rev, timelineEpoch: room.timelineEpoch, effectiveAt: room.startAt, position: room.position, commandId: `resume-${rev}` });
      broadcastSnapshot(room);
      return;
    }

    if (m.type === "stop") {
      if (!["playing", "pausing", "armed"].includes(room.state)) return;
      if (room.state === "armed") {
        room.position = finite(room.position);
        room.state = "stopped"; room.startAt = null; room.startedAt = null; room.pauseAt = room.stopAt = null; room.pendingSeek = null;
        const rev = bump(room, true);
        broadcast(room, { type: "stopped", revision: rev, timelineEpoch: room.timelineEpoch, position: room.position });
        broadcastSnapshot(room);
        return;
      }
      const effectiveAt = now() + adaptiveLeadMs(room, null, 400, 1800);
      const position = authoritativeAudioPosition(room, effectiveAt);
      room.state = "stopping"; room.stopAt = effectiveAt; room.stopPosition = position; room.pendingSeek = null;
      const rev = bump(room, true);
      broadcast(room, { type: "stopScheduled", revision: rev, timelineEpoch: room.timelineEpoch, effectiveAt, position, commandId: `stop-${rev}` });
      broadcastSnapshot(room);
      return;
    }

    if (m.type === "reset") {
      room.state = room.track ? "ready" : "idle";
      room.position = 0; room.startAt = room.startedAt = room.pauseAt = room.stopAt = null;
      room.pausePosition = room.stopPosition = null; room.pendingSeek = null;
      const rev = bump(room, true);
      broadcast(room, { type: "reset", revision: rev, timelineEpoch: room.timelineEpoch, position: 0 });
      broadcastSnapshot(room);
      return;
    }

    if (m.type === "seek") {
      if (!room.track) return;
      const durationBound = finite(m.duration, 0);
      const p = Math.max(0, finite(m.position, 0));
      const position = durationBound > 0 ? Math.min(p, durationBound) : p;
      if (["playing", "pausing", "stopping"].includes(room.state) && room.startedAt != null) {
        const effectiveAt = now() + adaptiveLeadMs(room, null, 500, 2200);
        room.pendingSeek = { effectiveAt, position };
        const rev = bump(room, true);
        broadcast(room, { type: "seekLive", revision: rev, timelineEpoch: room.timelineEpoch, effectiveAt, position, commandId: `seek-${rev}` });
      } else {
        room.position = position;
        const rev = bump(room, true);
        broadcast(room, { type: "seek", revision: rev, timelineEpoch: room.timelineEpoch, position });
      }
      broadcastSnapshot(room);
      return;
    }

    if (m.type === "syncAll") {
      if (room.state !== "playing" || room.startedAt == null) return;
      const effectiveAt = now() + adaptiveLeadMs(room, null, 1800, 8000);
      const position = authoritativeAudioPosition(room, effectiveAt);
      const rev = bump(room);
      const commandId = `all-${rev}-${crypto.randomBytes(4).toString("hex")}`;
      send(client, { type: "syncAllDispatch", revision: rev, timelineEpoch: room.timelineEpoch || 0, effectiveAt, position, commandId });
      for (const peer of room.clients.values()) {
        if (peer.id === client.id || peer.role === "host") continue;
        if (peer.info.rtcState === "connected") continue;
        send(peer, { type: "syncNow", revision: rev, timelineEpoch: room.timelineEpoch || 0, effectiveAt, position, reason: "host-broadcast-fallback", commandId });
      }
      broadcastSnapshot(room);
      return;
    }

    if (m.type === "next" || m.type === "previous") {
      const queue = Array.isArray(room.queue) ? room.queue : [];
      if (!queue.length) return send(client, { type: "error", message: "Queue is empty." });
      let idx = room.queueIndex || 0;
      if (m.type === "next") {
        if (room.repeatMode === "one") idx = idx;
        else if (room.shuffle) idx = Math.floor(Math.random() * queue.length);
        else idx = idx + 1;
        if (idx >= queue.length && room.repeatMode === "all") idx = 0;
        if (idx >= queue.length) return send(client, { type: "queueEnd", revision: room.revision });
      } else {
        idx = Math.max(0, idx - 1);
      }
      return activateQueuedTrack(room, idx, { reason: m.type });
    }
    if (m.type === "queue") {
      if (Array.isArray(m.repeatMode)) return;
      room.repeatMode = ["off","one","all"].includes(m.repeatMode) ? m.repeatMode : room.repeatMode;
      room.shuffle = Boolean(m.shuffle);
      const rev = bump(room);
      broadcastSnapshot(room);
      return send(client, { type: "queueUpdated", revision: rev, repeatMode: room.repeatMode, shuffle: room.shuffle });
    }

    if (m.type === "volume") {
      room.volume = finiteClamp(m.volume, 0, 1, 1); room.muted = false;
      for (const c of room.clients.values()) c.info.volume = room.volume;
      const rev = bump(room);
      broadcast(room, { type: "volume", revision: rev, volume: room.volume }); broadcastSnapshot(room); return;
    }
    if (m.type === "mute") {
      room.muted = Boolean(m.muted);
      const effective = room.muted ? 0 : room.volume;
      for (const c of room.clients.values()) c.info.volume = effective;
      const rev = bump(room);
      broadcast(room, { type: "mute", revision: rev, muted: room.muted, volume: room.volume }); broadcastSnapshot(room); return;
    }
    if (m.type === "trim") {
      const target = room.clients.get(String(m.clientId || ""));
      if (!target || target.role === "host") return;
      target.info.trimMs = finiteClamp(m.trimMs, -500, 500, 0);
      const rev = bump(room);
      send(target, { type: "trim", revision: rev, trimMs: target.info.trimMs }); broadcastSnapshot(room); return;
    }
    if (m.type === "lockRoom") {
      room.roomLocked = Boolean(m.locked);
      const rev = bump(room);
      broadcast(room, { type: "roomLock", revision: rev, locked: room.roomLocked }, client.id); broadcastSnapshot(room); return;
    }
    if (m.type === "kick") {
      const target = room.clients.get(String(m.clientId || ""));
      if (!target || target.id === client.id) return;
      send(target, { type: "kicked", revision: room.revision });
      try { target.ws.close(4003, "Removed by host"); } catch {}
      return;
    }
  });

  ws.on("close", () => {
    clearInterval(heartbeatTimer);
    if (!client) return;
    const room = client.room;
    room.clients.delete(client.id);
    if (room.hostId === client.id) {
      room.hostId = null;
      const wasActive = ["playing", "pausing", "stopping", "armed"].includes(room.state);
      if (wasActive) {
        room.position = timelinePosition(room, now());
        room.state = room.track ? "stopped" : "idle";
      }
      room.startAt = room.startedAt = room.pauseAt = room.stopAt = null;
      room.pendingSeek = null;
      const rev = bump(room);
      broadcast(room, { type: "hostGone", revision: rev, position: room.position });
      if (wasActive) broadcast(room, { type: "stopped", revision: rev, timelineEpoch: room.timelineEpoch || 0, position: room.position });
    } else if (room.hostId) {
      const host = room.clients.get(room.hostId);
      if (host) send(host, { type: "rtcPeerLeft", peerId: client.id });
    }
    broadcastSnapshot(room);
  });
});

setInterval(() => {
  const t = now();
  for (const room of rooms.values()) {
    for (const c of room.clients.values()) {
      if (t - c.info.lastSeen > CLIENT_DEAD_MS) { try { c.ws.terminate(); } catch {} }
    }
    if (t >= (room.nextSnapshotAt || 0)) { room.nextSnapshotAt = t + 500; broadcastSnapshot(room); }

    if (room.state === "armed" && room.startAt != null && t >= room.startAt) {
      room.state = "playing";
      room.position = Math.max(0, finite(room.startPosition, finite(room.position, 0)));
      room.startedAt = room.startAt - room.position * 1000;
      room.startAt = null; room.pauseAt = room.stopAt = null;
      room.startPosition = room.position;
      const rev = bump(room);
      broadcast(room, { type: "playing", revision: rev, timelineEpoch: room.timelineEpoch || 0, startedAt: room.startedAt, position: room.position }); broadcastSnapshot(room);
    }
    if (room.state === "pausing" && room.pauseAt != null && t >= room.pauseAt) {
      room.state = "paused"; room.position = room.pausePosition; room.pauseAt = room.pausePosition = null; room.startedAt = null;
      const rev = bump(room);
      broadcast(room, { type: "paused", revision: rev, timelineEpoch: room.timelineEpoch || 0, position: room.position }); broadcastSnapshot(room);
    }
    if (room.state === "stopping" && room.stopAt != null && t >= room.stopAt) {
      room.state = "stopped"; room.position = room.stopPosition; room.stopAt = room.stopPosition = null; room.startedAt = null; room.startAt = null;
      const rev = bump(room);
      broadcast(room, { type: "stopped", revision: rev, timelineEpoch: room.timelineEpoch || 0, position: room.position }); broadcastSnapshot(room);
    }
    if (room.state === "playing" && room.startedAt != null && Number.isFinite(room.track?.durationSec) && room.track.durationSec > 0 && t >= room.startedAt + room.track.durationSec * 1000) {
      room.state = "stopped"; room.position = room.track.durationSec; room.startedAt = null; room.startAt = room.pauseAt = room.stopAt = null;
      const rev = bump(room);
      broadcast(room, { type: "stopped", revision: rev, timelineEpoch: room.timelineEpoch || 0, position: room.position, reason: "track-ended" }); broadcastSnapshot(room);
    }
    if (room.pendingSeek && t >= room.pendingSeek.effectiveAt) {
      const p = room.pendingSeek.position;
      room.startedAt = room.pendingSeek.effectiveAt - p * 1000;
      room.position = p; room.pendingSeek = null;
      const rev = bump(room);
      broadcast(room, { type: "seekCommit", revision: rev, timelineEpoch: room.timelineEpoch || 0, startedAt: room.startedAt, position: p }); broadcastSnapshot(room);
    }
    if (room.clients.size === 0 && t - room.lastActivity > IDLE_ROOM_TTL_MS) removeRoom(room);
    else if (t - room.createdAt > ROOM_TTL_MS) removeRoom(room);
  }
  if (t >= nextPersistAt) { nextPersistAt = t + 5000; persistRooms(); }
  for (const [k, arr] of rateBuckets) {
    const fresh = arr.filter(x => t - x < 5 * 60_000);
    if (fresh.length) rateBuckets.set(k, fresh); else rateBuckets.delete(k);
  }
}, 100);

function shutdown() {
  persistRooms();
  try { bonjour?.destroy?.(); } catch {}
  try { wss.close(); } catch {}
  try { server.close(); } catch {}
}
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\nSonicSync v10.0.3 running`);
  console.log(`Local:        http://localhost:${PORT}`);
  console.log(`LAN:          http://${localIPv4()}:${PORT}`);
  console.log(`Other LAN IPs: ${localIPv4Candidates().join(", ")}`);
  console.log(`Host:         ${hostName()}`);
  console.log(`Discovery:    ${bonjour ? "mDNS / Bonjour enabled" : "disabled"}`);
  console.log(`Internet:     NOT REQUIRED`);
  console.log(`Audio path:   preload -> local audio engine -> shared timeline`);
});
