import QRCode from "qrcode";

const PROTOCOL_VERSION = 2;
const MAX_CONTROL_BYTES = 128 * 1024;
const MAX_ROOMS_PER_HOUR = 5;
const MAX_CLIENTS = 32;
const MAX_TRACK_BYTES = 25 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_UPLOADS_PER_HOUR = 20;
const ROOM_RE = /^[A-Z0-9]{6}$/;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }
  });
}
function randomHex(bytes = 16) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, function (x) { return x.toString(16).padStart(2, "0"); }).join("");
}
function safeName(value) {
  return String(value || "track").replace(/[\u0000-\u001f\u007f/\\]/g, "").trim().slice(0, 120) || "track";
}
function roomStub(env, room) {
  return env.ROOMS.get(env.ROOMS.idFromName(String(room).toUpperCase()));
}
function forwardedRequest(request, internalPath) {
  return new Request(new URL(internalPath, "https://sonicsync-room.internal"), request);
}
function originOf(request) { return new URL(request.url).origin; }
function allowedMedia(name, mime) {
  const ext = String(name || "").toLowerCase().split(".").pop();
  return ext === "mp3" || ext === "wav" || mime === "audio/mpeg" || mime === "audio/wav" || mime === "audio/x-wav";
}
function canonicalMime(name) { return String(name || "").toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg"; }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/api/health") return json({
      status: "ok", version: "10.1.0-public-beta", backendMode: "public",
      coordination: "sqlite-durable-object", mediaMode: "bounded-chunked-upload",
      freeTierGuardrails: true, physicalSyncVerified: false
    });
    if (request.method === "GET" && path === "/api/config") return json({
      version: "10.1.0-public-beta", backendMode: "public", publicRooms: true,
      joinBase: originOf(request), hostname: "SonicSync Public", noInternetRequired: false,
      nearbyDiscovery: false, protocolVersion: PROTOCOL_VERSION, uploadMaxBytes: MAX_TRACK_BYTES,
      uploadChunkBytes: CHUNK_BYTES,
      transport: "Public HTTPS + room WebSocket coordination + direct WebRTC where available; media is fetched and decoded locally.",
      browserMode: "Public rooms require Internet for coordination. Use the Node server for nearby/offline mode."
    });
    if (request.method === "GET" && path === "/api/time") return json({ now: Date.now() });

    if (request.method === "POST" && path === "/api/room") {
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const limiter = env.ROOMS.get(env.ROOMS.idFromName("__sonicsync_global_control__"));
      const limited = await limiter.fetch("https://sonicsync-room.internal/_internal/rate/room", {
        method: "POST", headers: { "x-client-ip": ip }
      });
      if (!limited.ok) return limited;
      for (let attempt = 0; attempt < 4; attempt++) {
        const id = randomHex(4).slice(0, 6).toUpperCase();
        const hostToken = randomHex(32);
        const created = await roomStub(env, id).fetch("https://sonicsync-room.internal/_internal/create", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, hostToken, now: Date.now() })
        });
        if (created.status === 409) continue;
        if (!created.ok) return json({ error: "Could not create the room. Please retry." }, 503);
        return json({ id, hostToken, joinBase: originOf(request), hostname: "SonicSync Public", discoveryService: null }, 201);
      }
      return json({ error: "Could not allocate a unique room code. Please retry." }, 503);
    }

    const qr = path.match(/^\/api\/qr\/([A-Z0-9]{6})$/i);
    if (request.method === "GET" && qr) {
      const room = qr[1].toUpperCase();
      const exists = await roomStub(env, room).fetch("https://sonicsync-room.internal/_internal/exists");
      if (!exists.ok) return json({ error: "Room not found or expired." }, 404);
      const svg = await QRCode.toString(originOf(request) + "/?room=" + room, { type: "svg", margin: 2, width: 512, errorCorrectionLevel: "M" });
      return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store" } });
    }

    const diagnostics = path.match(/^\/api\/room\/([A-Z0-9]{6})\/diagnostics$/i);
    if (request.method === "GET" && diagnostics) {
      return roomStub(env, diagnostics[1]).fetch(forwardedRequest(request, "/_internal/diagnostics" + url.search));
    }
    const uploadBegin = path.match(/^\/api\/public-upload\/([A-Z0-9]{6})\/begin$/i);
    if (request.method === "POST" && uploadBegin) {
      return roomStub(env, uploadBegin[1]).fetch(forwardedRequest(request, "/_internal/upload/begin"));
    }
    const uploadChunk = path.match(/^\/api\/public-upload\/([A-Z0-9]{6})\/([a-f0-9]{24,64})\/(\d+)$/i);
    if (request.method === "PUT" && uploadChunk) {
      return roomStub(env, uploadChunk[1]).fetch(forwardedRequest(request, "/_internal/upload/" + uploadChunk[2] + "/" + uploadChunk[3]));
    }
    const uploadComplete = path.match(/^\/api\/public-upload\/([A-Z0-9]{6})\/([a-f0-9]{24,64})\/complete$/i);
    if (request.method === "POST" && uploadComplete) {
      return roomStub(env, uploadComplete[1]).fetch(forwardedRequest(request, "/_internal/upload/" + uploadComplete[2] + "/complete"));
    }
    const media = path.match(/^\/media\/([A-Z0-9]{6})\/([a-f0-9]{24,64})$/i);
    if ((request.method === "GET" || request.method === "HEAD") && media) {
      return roomStub(env, media[1]).fetch(forwardedRequest(request, "/_internal/media/" + media[2]));
    }
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const room = String(url.searchParams.get("room") || "").toUpperCase();
      if (!ROOM_RE.test(room)) return new Response("Room code is required in the WebSocket URL.", { status: 400 });
      return roomStub(env, room).fetch(forwardedRequest(request, "/_internal/ws?room=" + room));
    }
    if (path.startsWith("/api/") || path.startsWith("/media/")) return json({ error: "Route not found." }, 404);
    return env.ASSETS.fetch(request);
  }
};

export class RoomCoordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec("CREATE TABLE IF NOT EXISTS room_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at INTEGER NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS upload_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS media_chunks (upload_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, body BLOB NOT NULL, PRIMARY KEY(upload_id, chunk_index))");
      this.sql.exec("CREATE TABLE IF NOT EXISTS room_create_rate (client_ip TEXT NOT NULL, created_at INTEGER NOT NULL)");
      this.sql.exec("CREATE INDEX IF NOT EXISTS room_create_rate_time ON room_create_rate(created_at)");
    });
  }
  async fetch(request) {
    const url = new URL(request.url), path = url.pathname;
    if (path === "/_internal/rate/room" && request.method === "POST") return this.rateRoomCreate(request);
    if (path === "/_internal/create" && request.method === "POST") return this.createRoom(request);
    if (path === "/_internal/exists" && request.method === "GET") return this.readRoom() ? new Response("ok") : new Response("not found", { status: 404 });
    if (path === "/_internal/diagnostics" && request.method === "GET") return this.diagnostics(request);
    if (path === "/_internal/upload/begin" && request.method === "POST") return this.beginUpload(request);
    const chunk = path.match(/^\/_internal\/upload\/([a-f0-9]{24,64})\/(\d+)$/i);
    if (chunk && request.method === "PUT") return this.putChunk(request, chunk[1], Number(chunk[2]));
    const complete = path.match(/^\/_internal\/upload\/([a-f0-9]{24,64})\/complete$/i);
    if (complete && request.method === "POST") return this.completeUpload(request, complete[1]);
    const media = path.match(/^\/_internal\/media\/([a-f0-9]{24,64})$/i);
    if (media && (request.method === "GET" || request.method === "HEAD")) return this.serveMedia(request, media[1]);
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket" && path === "/_internal/ws") return this.openSocket();
    return json({ error: "Not found." }, 404);
  }
  async rateRoomCreate(request) {
    const ip = String(request.headers.get("x-client-ip") || "unknown").slice(0, 80), now = Date.now();
    this.sql.exec("DELETE FROM room_create_rate WHERE created_at < ?", now - 3600000);
    const count = Number(this.sql.exec("SELECT COUNT(*) AS n FROM room_create_rate WHERE client_ip = ?", ip).toArray()[0]?.n || 0);
    if (count >= MAX_ROOMS_PER_HOUR) return json({ error: "Too many rooms created from this network. Try again later." }, 429);
    this.sql.exec("INSERT INTO room_create_rate (client_ip, created_at) VALUES (?, ?)", ip, now);
    return new Response(null, { status: 204 });
  }
  readRoom() {
    const row = this.sql.exec("SELECT payload FROM room_state WHERE id = 1").toArray()[0];
    if (!row) return null;
    try { return JSON.parse(row.payload); } catch { return null; }
  }
  saveRoom(room) {
    room.lastActivity = Date.now();
    this.sql.exec("INSERT INTO room_state (id, payload, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at", JSON.stringify(room), Date.now());
  }
  requireRoom() {
    const room = this.readRoom();
    return room && Date.now() - room.createdAt <= ROOM_TTL_MS ? room : null;
  }
  hostMatches(room, request) {
    const token = String(request.headers.get("x-sonicsync-host") || ""), expected = String(room?.hostToken || "");
    if (!token || token.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  }
  async createRoom(request) {
    const body = await request.json().catch(() => null);
    if (!body || !ROOM_RE.test(String(body.id || "")) || !/^[a-f0-9]{64}$/.test(String(body.hostToken || ""))) return json({ error: "Invalid room initialization." }, 400);
    if (this.readRoom()) return json({ error: "Room code collision." }, 409);
    const room = {
      id: body.id, hostToken: body.hostToken, createdAt: Number(body.now) || Date.now(), lastActivity: Date.now(),
      track: null, queue: [], queueIndex: 0, trackGeneration: 0, repeatMode: "off", shuffle: false,
      state: "idle", position: 0, startPosition: 0, startAt: null, startedAt: null,
      pauseAt: null, pausePosition: null, stopAt: null, pendingSeek: null, volume: 1, muted: false,
      syncLeadMs: 3000, roomLocked: false, revision: 0, timelineEpoch: 0, trackUploads: [], hostId: null
    };
    this.saveRoom(room);
    await this.ctx.storage.setAlarm(room.createdAt + ROOM_TTL_MS);
    return json({ id: room.id }, 201);
  }
  attachment(ws) { try { return ws.deserializeAttachment() || null; } catch { return null; } }
  writeAttachment(ws, attachment) { ws.serializeAttachment(attachment); }
  send(ws, payload) {
    try { if (ws.readyState === 1) ws.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, messageId: crypto.randomUUID(), timestamp: Date.now(), ...payload })); } catch {}
  }
  clients(room) {
    return this.ctx.getWebSockets().map(ws => ({ ws, a: this.attachment(ws) })).filter(x => x.a?.id && x.a.roomId === room.id);
  }
  broadcast(room, payload, exceptId = null) {
    for (const item of this.clients(room)) if (item.a.id !== exceptId) this.send(item.ws, payload);
  }
  bump(room, timelineChange = false) {
    room.revision++;
    if (timelineChange) room.timelineEpoch++;
  }
  position(room, at = Date.now()) {
    if (["playing", "pausing", "stopping"].includes(room.state) && room.startedAt != null) {
      const cap = room.state === "pausing" ? room.pauseAt : room.state === "stopping" ? room.stopAt : at;
      return Math.max(0, room.startPosition + (Math.min(at, cap || at) - room.startedAt) / 1000);
    }
    if (room.state === "armed" && room.startAt != null) return Math.max(0, room.startPosition);
    return Math.max(0, Number(room.position) || 0);
  }
  readySummary(room, items) {
    const total = items.length, trackId = room.track?.id;
    const prepared = trackId ? items.filter(c => c.a.readyTrackId === trackId && c.a.info.audioReady).length : 0;
    const enabled = trackId ? items.filter(c => c.a.readyTrackId === trackId && c.a.info.audioReady && c.a.info.audioEnabled).length : 0;
    const clockReady = trackId ? items.filter(c => c.a.readyTrackId === trackId && c.a.info.audioReady && c.a.info.clockSampleCount >= 3).length : 0;
    const clockLocked = trackId ? items.filter(c => c.a.readyTrackId === trackId && c.a.info.audioReady && c.a.info.clockLocked).length : 0;
    return { total, prepared, enabled, clockReady, clockLocked, ready: enabled };
  }
  snapshot(room) {
    const items = this.clients(room);
    return {
      id: room.id, revision: room.revision, createdAt: room.createdAt, hostId: room.hostId, track: room.track,
      state: room.state, position: this.position(room), masterAudioPosition: this.position(room), authoritativeAudioBiasMs: 0,
      startedAt: room.startedAt, startAt: room.startAt, timelineEpoch: room.timelineEpoch, pauseAt: room.pauseAt,
      stopAt: room.stopAt, volume: room.volume, muted: room.muted, syncLeadMs: room.syncLeadMs,
      queue: room.queue || [], queueIndex: room.queueIndex || 0, trackGeneration: room.trackGeneration || 0,
      repeatMode: room.repeatMode || "off", shuffle: Boolean(room.shuffle), roomLocked: room.roomLocked,
      serverNow: Date.now(), ready: this.readySummary(room, items),
      devices: items.map(({ a }) => ({
        id: a.id, name: a.info.name, role: a.role, joinedAt: a.joinedAt,
        offsetMs: a.info.offsetMs, clockDriftPpm: a.info.clockDriftPpm, clockJitterMs: a.info.clockJitterMs,
        clockUncertaintyMs: a.info.clockUncertaintyMs, syncConfidence: a.info.syncConfidence, rttMs: a.info.rttMs,
        syncErrorMs: a.info.syncErrorMs, outputLatencyMs: a.info.outputLatencyMs, baseLatencyMs: a.info.baseLatencyMs,
        trimMs: a.info.trimMs, volume: a.info.volume, bufferSec: a.info.bufferSec, status: a.info.status,
        transport: a.info.transport, rtcState: a.info.rtcState, clockLocked: a.info.clockLocked,
        clockSampleCount: a.info.clockSampleCount, audioReady: a.info.audioReady, audioEnabled: a.info.audioEnabled,
        lastSyncAt: a.info.lastSyncAt, lastSyncErrorMs: a.info.lastSyncErrorMs, rateCorrectionPpm: a.info.rateCorrectionPpm,
        lastSeen: a.info.lastSeen
      }))
    };
  }
  broadcastSnapshot(room) { this.broadcast(room, { type: "snapshot", revision: room.revision, snapshot: this.snapshot(room) }); }
  adaptiveLead(room, items, floor = 1300, ceiling = 6000) {
    const rtts = items.map(c => Number(c.a.info.rttMs) || 0).filter(n => n > 0);
    const jitters = items.map(c => Number(c.a.info.clockJitterMs) || 0).filter(n => n > 0);
    const uncertainty = items.map(c => Number(c.a.info.clockUncertaintyMs) || 0).filter(n => n > 0);
    const estimate = (rtts.length ? Math.max(...rtts) * 1.5 : 30) + (jitters.length ? Math.max(...jitters) * 3 : 15) + (uncertainty.length ? Math.max(...uncertainty) * 2 : 6) + 150;
    return Math.max(floor, Math.min(ceiling, estimate));
  }
  async openSocket() {
    if (!this.requireRoom()) return new Response("Room not found or expired.", { status: 404 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(ws, raw) {
    const room = this.requireRoom();
    if (!room) return this.send(ws, { type: "error", message: "Room not found or expired." });
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    if (text.length > MAX_CONTROL_BYTES) return this.send(ws, { type: "error", message: "Control packet is too large." });
    let m;
    try { m = JSON.parse(text); } catch { return this.send(ws, { type: "error", message: "Invalid control packet." }); }
    if (!m || typeof m !== "object" || typeof m.type !== "string") return this.send(ws, { type: "error", message: "Invalid control packet." });
    let a = this.attachment(ws), items = this.clients(room);
    if (!a && m.type === "join") {
      const requestedHost = m.role === "host";
      const host = requestedHost && this.hostMatches(room, new Request("https://internal.invalid", { headers: { "x-sonicsync-host": String(m.hostToken || "") } }));
      if (requestedHost && !host) return this.send(ws, { type: "error", message: "Host authorization failed." });
      if (room.roomLocked && !host) return this.send(ws, { type: "error", message: "This room is locked." });
      if (items.length >= MAX_CLIENTS && !host) return this.send(ws, { type: "error", message: "Room is full." });
      const id = randomHex(12), role = host ? "host" : "client";
      if (host && room.hostId) {
        const old = items.find(x => x.a.id === room.hostId);
        if (old) { old.a.replaced = true; this.writeAttachment(old.ws, old.a); try { old.ws.close(4001, "Host reconnected"); } catch {} }
      }
      const info = {
        name: safeName(m.name || (host ? "Host" : "Speaker")).slice(0, 32), role, joinedAt: Date.now(),
        offsetMs: 0, clockDriftPpm: 0, clockJitterMs: 0, rttMs: 0, syncErrorMs: 0,
        outputLatencyMs: 0, baseLatencyMs: 0, clockUncertaintyMs: 0, syncConfidence: 0,
        rateCorrectionPpm: 0, clockLocked: false, clockSampleCount: 0, audioReady: false, audioEnabled: false,
        trimMs: 0, volume: room.muted ? 0 : room.volume, bufferSec: 0, status: "connected",
        transport: "Public WS", rtcState: "disconnected", lastSeen: Date.now(), lastSyncAt: null,
        lastSyncErrorMs: 0, syncFailures: 0, durationSec: 0
      };
      a = { id, roomId: room.id, role, joinedAt: Date.now(), readyTrackId: null, info };
      this.writeAttachment(ws, a);
      if (host) room.hostId = id;
      this.bump(room); this.saveRoom(room);
      this.send(ws, { type: "welcome", revision: room.revision, clientId: id, role, serverNow: Date.now(), snapshot: this.snapshot(room) });
      if (room.track) this.send(ws, { type: "trackOffer", revision: room.revision, timelineEpoch: room.timelineEpoch, trackGeneration: room.trackGeneration, track: room.track });
      if (room.state === "armed" && room.startAt != null) this.send(ws, { type: "schedule", revision: room.revision, timelineEpoch: room.timelineEpoch, effectiveAt: room.startAt, position: room.startPosition, commandId: "start-" + room.revision });
      else if (room.state === "playing" && room.startedAt != null) {
        const effectiveAt = Date.now() + this.adaptiveLead(room, [{ ws: ws, a: a }], 1100, 5000);
        this.send(ws, { type: "syncNow", revision: room.revision, timelineEpoch: room.timelineEpoch, effectiveAt: effectiveAt, position: this.position(room, effectiveAt), reason: "late-join", commandId: "late-" + room.revision });
      } else if (room.state === "paused" || room.state === "stopped") this.send(ws, { type: "position", revision: room.revision, position: room.position, state: room.state });
      items = this.clients(room);
      if (host) {
        for (const peer of items) if (peer.a.id !== id && peer.a.role !== "host") {
          this.send(ws, { type: "rtcPeerJoin", peerId: peer.a.id, name: peer.a.info.name });
          this.send(peer.ws, { type: "rtcHostAvailable", hostId: id });
        }
      } else if (room.hostId) {
        const hostClient = items.find(x => x.a.id === room.hostId);
        if (hostClient) this.send(hostClient.ws, { type: "rtcPeerJoin", peerId: id, name: info.name });
      }
      this.broadcastSnapshot(room); return;
    }
    if (!a || a.roomId !== room.id) return this.send(ws, { type: "error", message: "Join this room before sending commands." });
    a.info.lastSeen = Date.now();

    if (m.type === "rtcSignal") {
      const target = items.find(x => x.a.id === String(m.targetClientId || ""));
      if (target && target.a.id !== a.id && m.payload != null && JSON.stringify(m.payload).length <= 32 * 1024) this.send(target.ws, { type: "rtcSignal", fromClientId: a.id, payload: m.payload });
      return;
    }
    if (m.type === "rtcState") {
      a.info.rtcState = ["new","connecting","connected","disconnected","failed","closed"].includes(m.state) ? m.state : "disconnected";
      a.info.transport = a.info.rtcState === "connected" ? "RTC-P2P" : "Public WS"; this.writeAttachment(ws, a); return;
    }
    if (m.type === "sync") {
      const t1 = Number(m.t1); if (!Number.isFinite(t1)) return;
      const t2 = Date.now(); this.send(ws, { type: "syncReply", seq: m.seq, t1: t1, t2: t2, t3: Date.now() }); return;
    }
    if (m.type === "telemetry") {
      const ranges = { offsetMs: [-120000,120000], clockDriftPpm: [-1000,1000], clockJitterMs: [0,500], rttMs: [0,10000], syncErrorMs: [-10000,10000], clockUncertaintyMs: [0,5000], syncConfidence: [0,1], rateCorrectionPpm: [-20000,20000], outputLatencyMs: [0,5000], baseLatencyMs: [0,5000], bufferSec: [0,3600], durationSec: [0,86400], trimMs: [-500,500] };
      for (const key in ranges) if (m[key] != null && Number.isFinite(Number(m[key]))) a.info[key] = Math.max(ranges[key][0], Math.min(ranges[key][1], Number(m[key])));
      a.info.clockLocked = Boolean(m.clockLocked); a.info.clockSampleCount = Math.max(0, Math.min(1000, Math.floor(Number(m.clockSampleCount) || 0)));
      a.info.audioReady = Boolean(m.audioReady); a.info.audioEnabled = Boolean(m.audioEnabled);
      a.info.status = ["connected","preparing","ready","clock-sync","audio-gesture","scheduled","playing","paused","stopped","error","syncing"].includes(m.status) ? m.status : "connected";
      a.info.transport = String(m.transport || "Public WS").slice(0, 24); this.writeAttachment(ws, a); return;
    }
    if (m.type === "ready") {
      if (!room.track || m.trackId !== room.track.id) return;
      a.readyTrackId = room.track.id; a.info.audioReady = Boolean(m.audioReady); a.info.audioEnabled = Boolean(m.audioEnabled);
      a.info.clockLocked = Boolean(m.clockLocked); a.info.clockSampleCount = Math.max(0, Math.min(1000, Math.floor(Number(m.clockSampleCount) || 0)));
      a.info.bufferSec = Math.max(0, Math.min(3600, Number(m.bufferSec) || 0)); a.info.durationSec = Math.max(0, Math.min(86400, Number(m.durationSec) || 0));
      a.info.outputLatencyMs = Math.max(0, Math.min(5000, Number(m.outputLatencyMs) || 0)); a.info.baseLatencyMs = Math.max(0, Math.min(5000, Number(m.baseLatencyMs) || 0));
      a.info.status = a.info.audioReady ? (a.info.audioEnabled ? (a.info.clockLocked ? "ready" : "clock-sync") : "audio-gesture") : "preparing";
      this.writeAttachment(ws, a); this.send(ws, { type: "readyAck", revision: room.revision, trackId: room.track.id });
      if (room.state === "armed" && room.startAt != null && a.info.audioReady && a.info.audioEnabled) this.send(ws, { type: "schedule", revision: room.revision, timelineEpoch: room.timelineEpoch, effectiveAt: room.startAt, position: room.startPosition, commandId: "ready-" + room.revision + "-" + a.id });
      if (room.state === "playing" && room.startedAt != null && a.info.audioReady && a.info.audioEnabled) {
        const effectiveAt = Date.now() + this.adaptiveLead(room, [{ ws: ws, a: a }], 1100, 5000);
        this.send(ws, { type: "syncNow", revision: room.revision, timelineEpoch: room.timelineEpoch, effectiveAt: effectiveAt, position: this.position(room, effectiveAt), reason: "ready-while-playing", commandId: "ready-" + room.revision + "-" + a.id });
      }
      this.broadcastSnapshot(room); return;
    }
    if (m.type === "requestSync" || m.type === "syncMismatch") {
      if (room.state === "playing" && room.startedAt != null) {
        const lead = this.adaptiveLead(room, [{ ws: ws, a: a }], m.type === "requestSync" ? 1200 : 1800, 7000);
        const effectiveAt = Date.now() + lead;
        this.send(ws, { type: "syncNow", revision: room.revision, timelineEpoch: room.timelineEpoch, effectiveAt: effectiveAt, position: this.position(room, effectiveAt), reason: m.type, commandId: m.type + "-" + room.revision + "-" + Date.now() });
      } else if (["paused","stopped","ready"].includes(room.state)) this.send(ws, { type: "position", revision: room.revision, position: room.position, state: room.state });
      else this.send(ws, { type: "syncIdle", revision: room.revision });
      return;
    }
    if (m.type === "syncApplied") { a.info.lastSyncAt = Date.now(); a.info.lastSyncErrorMs = Number(m.errorMs) || 0; this.writeAttachment(ws, a); return; }
    if (a.role !== "host") return;

    if (m.type === "start") {
      if (!room.track) return this.send(ws, { type: "error", message: "Load a track first." });
      const summary = this.readySummary(room, this.clients(room));
      if (!summary.total || summary.prepared < summary.total || summary.clockReady < summary.total) return this.send(ws, { type: "error", message: "Playback locked until every connected device has decoded the track and clock-synced." });
      if (!a.info.audioEnabled) return this.send(ws, { type: "error", message: "Enable host audio with a tap first." });
      const lead = Math.max(2000, Math.min(10000, Number(m.leadMs) || this.adaptiveLead(room, this.clients(room))));
      room.syncLeadMs = lead; room.position = 0; room.startPosition = 0; room.startAt = Date.now() + lead;
      room.startedAt = null; room.pauseAt = room.stopAt = null; room.pendingSeek = null; room.state = "armed";
      this.bump(room, true); this.saveRoom(room); await this.ctx.storage.setAlarm(room.startAt);
      this.broadcast(room, { type: "schedule", revision: room.revision, timelineEpoch: room.timelineEpoch, effectiveAt: room.startAt, position: 0, commandId: "start-" + room.revision }); this.broadcastSnapshot(room); return;
    }
    if (m.type === "pause") {
      if (room.state !== "playing" || room.startedAt == null) return;
      const effectiveAt = Date.now() + this.adaptiveLead(room, this.clients(room), 400, 1800);
      room.pausePosition = this.position(room, effectiveAt); room.pauseAt = effectiveAt; room.state = "pausing"; room.pendingSeek = null;
      this.bump(room, true); this.saveRoom(room); await this.ctx.storage.setAlarm(effectiveAt);
      this.broadcast(room, { type: "pauseScheduled", revision: room.revision, timelineEpoch: room.timelineEpoch, effectiveAt: effectiveAt, position: room.pausePosition, commandId: "pause-" + room.revision }); this.broadcastSnapshot(room); return;
    }
    if (m.type === "resume") {
      if (!room.track || !["paused","stopped"].includes(room.state)) return;
      const summary = this.readySummary(room, this.clients(room));
      if (summary.prepared < summary.total || summary.clockReady < summary.total) return this.send(ws, { type: "error", message: "Resume locked until connected nodes have decoded the track and clock-synced." });
      const lead = Math.max(1200, Math.min(9000, Number(m.leadMs) || this.adaptiveLead(room, this.clients(room), 2200, 6500)));
      room.startPosition = Math.max(0, Number(room.position) || 0); room.startAt = Date.now() + lead; room.syncLeadMs = lead;
      room.startedAt = null; room.pauseAt = room.stopAt = null; room.pendingSeek = null; room.state = "armed";
      this.bump(room, true); this.saveRoom(room); await this.ctx.storage.setAlarm(room.startAt);
      this.broadcast(room, { type: "schedule", revision: room.revision, timelineEpoch: room.timelineEpoch, effectiveAt: room.startAt, position: room.startPosition, commandId: "resume-" + room.revision }); this.broadcastSnapshot(room); return;
    }
    if (m.type === "stop") {
      if (!["playing","pausing","stopping","armed"].includes(room.state)) return;
      if (room.state === "armed") {
        room.position = room.startPosition; room.state = "stopped"; room.startAt = room.startedAt = null; room.pauseAt = room.stopAt = null;
        this.bump(room, true); this.saveRoom(room); this.broadcast(room, { type: "stopped", revision: room.revision, timelineEpoch: room.timelineEpoch, position: room.position }); this.broadcastSnapshot(room); return;
      }
      const effectiveAt = Date.now() + this.adaptiveLead(room, this.clients(room), 400, 1800);
      room.stopAt = effectiveAt; room.state = "stopping"; room.position = this.position(room, effectiveAt); room.pendingSeek = null;
      this.bump(room, true); this.saveRoom(room); await this.ctx.storage.setAlarm(effectiveAt);
      this.broadcast(room, { type: "stopScheduled", revision: room.revision, timelineEpoch: room.timelineEpoch, effectiveAt: effectiveAt, position: room.position, commandId: "stop-" + room.revision }); this.broadcastSnapshot(room); return;
    }
    if (m.type === "reset") {
      room.state = room.track ? "ready" : "idle"; room.position = 0; room.startPosition = 0;
      room.startAt = room.startedAt = room.pauseAt = room.stopAt = null; room.pendingSeek = null;
      this.bump(room, true); this.saveRoom(room); this.broadcast(room, { type: "reset", revision: room.revision, timelineEpoch: room.timelineEpoch, position: 0 }); this.broadcastSnapshot(room); return;
    }
    if (m.type === "seek") {
      if (!room.track) return;
      const p = Math.max(0, Math.min(room.track.durationSec || 86400, Number(m.position) || 0));
      if (["playing","pausing","stopping"].includes(room.state) && room.startedAt != null) {
        const effectiveAt = Date.now() + this.adaptiveLead(room, this.clients(room), 500, 2200);
        room.pendingSeek = { effectiveAt: effectiveAt, position: p }; this.bump(room, true); this.saveRoom(room); await this.ctx.storage.setAlarm(effectiveAt);
        this.broadcast(room, { type: "seekLive", revision: room.revision, timelineEpoch: room.timelineEpoch, effectiveAt: effectiveAt, position: p, commandId: "seek-" + room.revision });
      } else {
        room.position = p; room.startPosition = p; this.bump(room, true); this.saveRoom(room);
        this.broadcast(room, { type: "seek", revision: room.revision, timelineEpoch: room.timelineEpoch, position: p });
      }
      this.broadcastSnapshot(room); return;
    }
    if (m.type === "syncAll") {
      if (room.state !== "playing" || room.startedAt == null) return;
      const effectiveAt = Date.now() + this.adaptiveLead(room, this.clients(room), 1800, 8000), position = this.position(room, effectiveAt);
      this.bump(room); const commandId = "all-" + room.revision + "-" + randomHex(4);
      this.send(ws, { type: "syncAllDispatch", revision: room.revision, timelineEpoch: room.timelineEpoch, effectiveAt: effectiveAt, position: position, commandId: commandId });
      for (const peer of this.clients(room)) if (peer.a.id !== a.id && peer.a.role !== "host" && peer.a.info.rtcState !== "connected") this.send(peer.ws, { type: "syncNow", revision: room.revision, timelineEpoch: room.timelineEpoch, effectiveAt: effectiveAt, position: position, reason: "host-broadcast-fallback", commandId: commandId });
      this.saveRoom(room); this.broadcastSnapshot(room); return;
    }
    if (m.type === "next" || m.type === "previous") {
      if (!room.queue.length) return this.send(ws, { type: "error", message: "Queue is empty." });
      let index = room.queueIndex;
      if (m.type === "next") {
        if (room.repeatMode !== "one") index = room.shuffle ? Math.floor(Math.random() * room.queue.length) : index + 1;
        if (index >= room.queue.length && room.repeatMode === "all") index = 0;
        if (index >= room.queue.length) return this.send(ws, { type: "queueEnd", revision: room.revision });
      } else index = Math.max(0, index - 1);
      room.queueIndex = index; room.track = room.queue[index]; room.trackGeneration++;
      room.state = "ready"; room.position = room.startPosition = 0; room.startAt = room.startedAt = null; room.pendingSeek = null;
      for (const peer of this.clients(room)) {
        peer.a.readyTrackId = null; peer.a.info.audioReady = false; peer.a.info.audioEnabled = false; peer.a.info.clockLocked = false; peer.a.info.clockSampleCount = 0; peer.a.info.bufferSec = 0; peer.a.info.status = "preparing"; this.writeAttachment(peer.ws, peer.a);
      }
      this.bump(room, true); this.saveRoom(room);
      this.broadcast(room, { type: "trackOffer", revision: room.revision, timelineEpoch: room.timelineEpoch, trackGeneration: room.trackGeneration, track: room.track, queueIndex: index, queueLength: room.queue.length }); this.broadcastSnapshot(room); return;
    }
    if (m.type === "queue") {
      if (["off","one","all"].includes(m.repeatMode)) room.repeatMode = m.repeatMode;
      room.shuffle = Boolean(m.shuffle); this.bump(room); this.saveRoom(room); this.broadcastSnapshot(room);
      this.send(ws, { type: "queueUpdated", revision: room.revision, repeatMode: room.repeatMode, shuffle: room.shuffle }); return;
    }
    if (m.type === "volume") {
      room.volume = Math.max(0, Math.min(1, Number(m.volume) || 0)); room.muted = false;
      for (const peer of this.clients(room)) { peer.a.info.volume = room.volume; this.writeAttachment(peer.ws, peer.a); }
      this.bump(room); this.saveRoom(room); this.broadcast(room, { type: "volume", revision: room.revision, volume: room.volume }); this.broadcastSnapshot(room); return;
    }
    if (m.type === "mute") {
      room.muted = Boolean(m.muted); const outputVolume = room.muted ? 0 : room.volume;
      for (const peer of this.clients(room)) { peer.a.info.volume = outputVolume; this.writeAttachment(peer.ws, peer.a); }
      this.bump(room); this.saveRoom(room); this.broadcast(room, { type: "mute", revision: room.revision, muted: room.muted, volume: room.volume }); this.broadcastSnapshot(room); return;
    }
    if (m.type === "trim") {
      const target = this.clients(room).find(c => c.a.id === String(m.clientId || ""));
      if (!target || target.a.role === "host") return;
      target.a.info.trimMs = Math.max(-500, Math.min(500, Number(m.trimMs) || 0)); this.writeAttachment(target.ws, target.a);
      this.bump(room); this.saveRoom(room); this.send(target.ws, { type: "trim", revision: room.revision, trimMs: target.a.info.trimMs }); this.broadcastSnapshot(room); return;
    }
    if (m.type === "lockRoom") {
      room.roomLocked = Boolean(m.locked); this.bump(room); this.saveRoom(room);
      this.broadcast(room, { type: "roomLock", revision: room.revision, locked: room.roomLocked }, a.id); this.broadcastSnapshot(room); return;
    }
    if (m.type === "kick") {
      const target = this.clients(room).find(c => c.a.id === String(m.clientId || ""));
      if (target && target.a.id !== a.id) { this.send(target.ws, { type: "kicked", revision: room.revision }); try { target.ws.close(4003, "Removed by host"); } catch {} }
    }
  }
  async webSocketClose(ws) {
    const a = this.attachment(ws);
    if (!a) return;
    const room = this.readRoom();
    if (!room) return;
    const items = this.clients(room);
    if (room.hostId === a.id && !a.replaced) {
      room.hostId = null; room.position = this.position(room); room.startPosition = room.position;
      const active = ["playing","pausing","stopping","armed"].includes(room.state);
      if (active) room.state = room.track ? "stopped" : "idle";
      room.startAt = room.startedAt = room.pauseAt = room.stopAt = null; room.pendingSeek = null;
      this.bump(room); this.saveRoom(room);
      this.broadcast(room, { type: "hostGone", revision: room.revision, position: room.position });
      if (active) this.broadcast(room, { type: "stopped", revision: room.revision, timelineEpoch: room.timelineEpoch, position: room.position });
    } else if (room.hostId) {
      const host = items.find(c => c.a.id === room.hostId);
      if (host) this.send(host.ws, { type: "rtcPeerLeft", peerId: a.id });
    }
    this.broadcastSnapshot(room);
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }
  async alarm() {
    const room = this.readRoom(), now = Date.now();
    if (!room) {
      this.sql.exec("DELETE FROM room_create_rate WHERE created_at < ?", now - 3600000);
      return;
    }
    if (now - room.createdAt >= ROOM_TTL_MS) {
      this.sql.exec("DELETE FROM room_state WHERE id = 1"); this.sql.exec("DELETE FROM upload_sessions"); this.sql.exec("DELETE FROM media_chunks");
      for (const ws of this.ctx.getWebSockets()) try { ws.close(1001, "Room expired"); } catch {}
      return;
    }
    if (room.state === "armed" && room.startAt != null && now >= room.startAt) {
      room.startedAt = room.startAt; room.startAt = null; room.state = "playing"; this.bump(room); this.saveRoom(room);
      this.broadcast(room, { type: "playing", revision: room.revision, timelineEpoch: room.timelineEpoch }); this.broadcastSnapshot(room);
    } else if (room.state === "pausing" && room.pauseAt != null && now >= room.pauseAt) {
      room.position = room.pausePosition; room.startPosition = room.position; room.startedAt = null; room.pauseAt = null; room.pausePosition = null; room.state = "paused";
      this.bump(room); this.saveRoom(room); this.broadcast(room, { type: "paused", revision: room.revision, timelineEpoch: room.timelineEpoch, position: room.position }); this.broadcastSnapshot(room);
    } else if (room.state === "stopping" && room.stopAt != null && now >= room.stopAt) {
      room.position = this.position(room, room.stopAt); room.startPosition = room.position; room.startedAt = null; room.stopAt = null; room.state = "stopped";
      this.bump(room); this.saveRoom(room); this.broadcast(room, { type: "stopped", revision: room.revision, timelineEpoch: room.timelineEpoch, position: room.position }); this.broadcastSnapshot(room);
    } else if (room.pendingSeek && now >= room.pendingSeek.effectiveAt) {
      const p = room.pendingSeek.position, at = room.pendingSeek.effectiveAt;
      room.startPosition = p; room.startedAt = at; room.position = p; room.pendingSeek = null;
      this.bump(room); this.saveRoom(room); this.broadcast(room, { type: "seekCommit", revision: room.revision, timelineEpoch: room.timelineEpoch, startedAt: at, position: p }); this.broadcastSnapshot(room);
    }
    const sessions = this.sql.exec("SELECT id, created_at FROM upload_sessions").toArray();
    for (const item of sessions) if (now - item.created_at > 10 * 60 * 1000) {
      this.sql.exec("DELETE FROM upload_sessions WHERE id = ?", item.id);
      this.sql.exec("DELETE FROM media_chunks WHERE upload_id = ?", item.id);
    }
    await this.ctx.storage.setAlarm(Math.min(room.createdAt + ROOM_TTL_MS, now + 10 * 60 * 1000));
  }
  async beginUpload(request) {
    const room = this.requireRoom();
    if (!room || !this.hostMatches(room, request)) return json({ error: "Invalid room or host authorization." }, 403);
    const body = await request.json().catch(() => null);
    if (!body || !allowedMedia(body.name, body.mime)) return json({ error: "Only MP3 and WAV uploads are supported in the public beta." }, 415);
    const bytes = Number(body.bytes), sha256 = String(body.sha256 || "").toLowerCase();
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_TRACK_BYTES) return json({ error: "Track must be 1 byte to 25 MiB." }, 413);
    if (!/^[a-f0-9]{64}$/.test(sha256)) return json({ error: "Invalid SHA-256 digest." }, 400);
    const now = Date.now();
    room.trackUploads = (room.trackUploads || []).filter(t => now - t < 3600000);
    if (room.trackUploads.length >= MAX_UPLOADS_PER_HOUR) return json({ error: "Room upload quota reached for this hour." }, 429);
    const uploadId = randomHex(24);
    const meta = { name: safeName(body.name), mime: canonicalMime(body.name), bytes: bytes, sha256: sha256, chunkSize: CHUNK_BYTES, chunkCount: Math.ceil(bytes / CHUNK_BYTES) };
    this.sql.exec("INSERT INTO upload_sessions (id, payload, created_at) VALUES (?, ?, ?)", uploadId, JSON.stringify(meta), now);
    await this.ctx.storage.setAlarm(Math.min(room.createdAt + ROOM_TTL_MS, now + 600000));
    return json({ uploadId: uploadId, chunkSize: CHUNK_BYTES, chunkCount: meta.chunkCount, maxBytes: MAX_TRACK_BYTES }, 201);
  }
  async putChunk(request, uploadId, index) {
    const room = this.requireRoom();
    if (!room || !this.hostMatches(room, request)) return json({ error: "Invalid room or host authorization." }, 403);
    const row = this.sql.exec("SELECT payload FROM upload_sessions WHERE id = ?", uploadId).toArray()[0];
    if (!row) return json({ error: "Upload session expired. Start the upload again." }, 404);
    const meta = JSON.parse(row.payload);
    if (!Number.isInteger(index) || index < 0 || index >= meta.chunkCount) return json({ error: "Invalid chunk index." }, 400);
    const bytes = new Uint8Array(await request.arrayBuffer());
    const expected = index === meta.chunkCount - 1 ? meta.bytes - index * meta.chunkSize : meta.chunkSize;
    if (bytes.byteLength !== expected) return json({ error: "Invalid chunk size." }, 400);
    const previous = this.sql.exec("SELECT body FROM media_chunks WHERE upload_id = ? AND chunk_index = ?", uploadId, index).toArray()[0];
    if (previous) {
      const old = previous.body instanceof Uint8Array ? previous.body : new Uint8Array(previous.body);
      if (old.byteLength === bytes.byteLength && old.every((value, i) => value === bytes[i])) return new Response(null, { status: 204 });
      return json({ error: "Conflicting payload already exists at this chunk index." }, 409);
    }
    this.sql.exec("INSERT INTO media_chunks (upload_id, chunk_index, body) VALUES (?, ?, ?)", uploadId, index, bytes);
    return new Response(null, { status: 204 });
  }
  async completeUpload(request, uploadId) {
    const room = this.requireRoom();
    if (!room || !this.hostMatches(room, request)) return json({ error: "Invalid room or host authorization." }, 403);
    const session = this.sql.exec("SELECT payload FROM upload_sessions WHERE id = ?", uploadId).toArray()[0];
    if (!session) return json({ error: "Upload session expired." }, 404);
    const meta = JSON.parse(session.payload);
    const chunks = this.sql.exec("SELECT chunk_index, body FROM media_chunks WHERE upload_id = ? ORDER BY chunk_index", uploadId).toArray();
    if (chunks.length !== meta.chunkCount) return json({ error: "Upload incomplete: received " + chunks.length + "/" + meta.chunkCount + " chunks." }, 409);
    const joined = new Uint8Array(meta.bytes); let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (Number(chunks[i].chunk_index) !== i) return json({ error: "Upload has a missing chunk." }, 409);
      const chunk = chunks[i].body instanceof Uint8Array ? chunks[i].body : new Uint8Array(chunks[i].body);
      joined.set(chunk, offset); offset += chunk.byteLength;
    }
    if (offset !== meta.bytes) return json({ error: "Uploaded byte count mismatch." }, 400);
    const digestBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
    const digest = Array.from(digestBytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    if (digest !== meta.sha256) {
      this.sql.exec("DELETE FROM upload_sessions WHERE id = ?", uploadId); this.sql.exec("DELETE FROM media_chunks WHERE upload_id = ?", uploadId);
      return json({ error: "SHA-256 verification failed. Upload was rejected." }, 422);
    }
    const track = { id: digest, url: "/media/" + room.id + "/" + uploadId, token: uploadId, name: meta.name, mime: meta.mime, bytes: meta.bytes, sha256: digest, durationSec: null };
    const duplicate = (room.queue || []).find(t => t.sha256 === digest);
    if (duplicate) track.durationSec = duplicate.durationSec || null;
    room.queue = Array.isArray(room.queue) ? room.queue : [];
    room.queue.push(track); room.queueIndex = room.queue.length - 1; room.track = track; room.trackGeneration++;
    room.state = "ready"; room.position = room.startPosition = 0; room.startAt = room.startedAt = room.pauseAt = room.stopAt = null;
    room.pausePosition = room.stopPosition = null; room.pendingSeek = null; room.trackUploads.push(Date.now());
    this.sql.exec("DELETE FROM upload_sessions WHERE id = ?", uploadId);
    this.bump(room, true); this.saveRoom(room);
    for (const peer of this.clients(room)) {
      peer.a.readyTrackId = null; peer.a.info.audioReady = false; peer.a.info.audioEnabled = false;
      peer.a.info.clockLocked = false; peer.a.info.clockSampleCount = 0; peer.a.info.bufferSec = 0; peer.a.info.syncErrorMs = 0; peer.a.info.status = "preparing";
      this.writeAttachment(peer.ws, peer.a);
    }
    this.broadcast(room, { type: "trackOffer", revision: room.revision, timelineEpoch: room.timelineEpoch, trackGeneration: room.trackGeneration, track: track });
    this.broadcastSnapshot(room);
    return json(track, 201);
  }
  async serveMedia(request, token) {
    const room = this.requireRoom();
    if (!room) return new Response(null, { status: 404 });
    const track = (room.queue || []).find(t => t.token === token);
    if (!track) return new Response(null, { status: 404 });
    const size = Number(track.bytes) || 0, range = request.headers.get("range");
    let start = 0, end = size - 1, status = 200;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
      if (!match[1]) {
        const suffix = Number(match[2] || 0);
        if (!Number.isSafeInteger(suffix) || suffix < 1) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
        start = Math.max(0, size - suffix); end = size - 1;
      } else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1; }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
      end = Math.min(end, size - 1); status = 206;
    }
    const first = Math.floor(start / CHUNK_BYTES), last = Math.floor(end / CHUNK_BYTES);
    const rows = this.sql.exec("SELECT chunk_index, body FROM media_chunks WHERE upload_id = ? AND chunk_index >= ? AND chunk_index <= ? ORDER BY chunk_index", token, first, last).toArray();
    const total = end - start + 1, body = new Uint8Array(total); let written = 0;
    for (const row of rows) {
      const idx = Number(row.chunk_index), chunk = row.body instanceof Uint8Array ? row.body : new Uint8Array(row.body);
      const globalStart = idx * CHUNK_BYTES, from = Math.max(start - globalStart, 0), to = Math.min(end - globalStart + 1, chunk.byteLength);
      if (to > from) { body.set(chunk.subarray(from, to), written); written += to - from; }
    }
    if (written !== total) return json({ error: "Media is incomplete or expired." }, 503);
    const headers = { "content-type": track.mime || "application/octet-stream", "accept-ranges": "bytes", "cache-control": "private, max-age=600", "content-length": String(total) };
    if (status === 206) headers["content-range"] = "bytes " + start + "-" + end + "/" + size;
    return request.method === "HEAD" ? new Response(null, { status: status, headers: headers }) : new Response(body, { status: status, headers: headers });
  }
  async diagnostics(request) {
    const room = this.requireRoom();
    if (!room || !this.hostMatches(room, request)) return json({ error: "Invalid host authorization." }, 403);
    const payload = { exportedAt: Date.now(), protocolVersion: PROTOCOL_VERSION, room: this.snapshot(room), limitations: ["Software telemetry is not acoustic measurement.", "Output and acoustic latency require physical instrumentation."] };
    if (new URL(request.url).searchParams.get("format") === "csv") {
      const cols = ["id","name","role","transport","rttMs","clockJitterMs","clockUncertaintyMs","clockDriftPpm","syncErrorMs","outputLatencyMs","trimMs","bufferSec","syncConfidence","status"];
      const csv = [cols.join(","), ...payload.room.devices.map(d => cols.map(k => JSON.stringify(d[k] ?? "")).join(","))].join("\n");
      return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=sonicsync-" + room.id + "-diagnostics.csv", "cache-control": "no-store" } });
    }
    return json(payload, 200, { "content-disposition": "attachment; filename=sonicsync-" + room.id + "-diagnostics.json" });
  }
  async webSocketClose(ws) {
    const a = this.attachment(ws); if (!a) return;
    const room = this.readRoom(); if (!room) return;
    const items = this.clients(room);
    if (room.hostId === a.id && !a.replaced) {
      room.hostId = null; room.position = this.position(room); room.startPosition = room.position;
      const active = ["playing","pausing","stopping","armed"].includes(room.state);
      if (active) room.state = room.track ? "stopped" : "idle";
      room.startAt = room.startedAt = room.pauseAt = room.stopAt = null; room.pendingSeek = null;
      this.bump(room); this.saveRoom(room); this.broadcast(room, { type: "hostGone", revision: room.revision, position: room.position });
      if (active) this.broadcast(room, { type: "stopped", revision: room.revision, timelineEpoch: room.timelineEpoch, position: room.position });
    } else if (room.hostId) {
      const host = items.find(c => c.a.id === room.hostId);
      if (host) this.send(host.ws, { type: "rtcPeerLeft", peerId: a.id });
    }
    this.broadcastSnapshot(room);
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }
  async alarm() {
    const room = this.readRoom(), now = Date.now();
    if (!room) { this.sql.exec("DELETE FROM room_create_rate WHERE created_at < ?", now - 3600000); return; }
    if (now - room.createdAt >= ROOM_TTL_MS) {
      this.sql.exec("DELETE FROM room_state WHERE id = 1"); this.sql.exec("DELETE FROM upload_sessions"); this.sql.exec("DELETE FROM media_chunks");
      for (const ws of this.ctx.getWebSockets()) try { ws.close(1001, "Room expired"); } catch {}
      return;
    }
    if (room.state === "armed" && room.startAt != null && now >= room.startAt) {
      room.startedAt = room.startAt; room.startAt = null; room.state = "playing"; this.bump(room); this.saveRoom(room);
      this.broadcast(room, { type: "playing", revision: room.revision, timelineEpoch: room.timelineEpoch }); this.broadcastSnapshot(room);
    } else if (room.state === "pausing" && room.pauseAt != null && now >= room.pauseAt) {
      room.position = room.pausePosition; room.startPosition = room.position; room.startedAt = null; room.pauseAt = null; room.pausePosition = null; room.state = "paused";
      this.bump(room); this.saveRoom(room); this.broadcast(room, { type: "paused", revision: room.revision, timelineEpoch: room.timelineEpoch, position: room.position }); this.broadcastSnapshot(room);
    } else if (room.state === "stopping" && room.stopAt != null && now >= room.stopAt) {
      room.position = this.position(room, room.stopAt); room.startPosition = room.position; room.startedAt = null; room.stopAt = null; room.state = "stopped";
      this.bump(room); this.saveRoom(room); this.broadcast(room, { type: "stopped", revision: room.revision, timelineEpoch: room.timelineEpoch, position: room.position }); this.broadcastSnapshot(room);
    } else if (room.pendingSeek && now >= room.pendingSeek.effectiveAt) {
      const p = room.pendingSeek.position, at = room.pendingSeek.effectiveAt;
      room.startPosition = p; room.startedAt = at; room.position = p; room.pendingSeek = null;
      this.bump(room); this.saveRoom(room); this.broadcast(room, { type: "seekCommit", revision: room.revision, timelineEpoch: room.timelineEpoch, startedAt: at, position: p }); this.broadcastSnapshot(room);
    }
    const sessions = this.sql.exec("SELECT id, created_at FROM upload_sessions").toArray();
    for (const item of sessions) if (now - item.created_at > 600000) { this.sql.exec("DELETE FROM upload_sessions WHERE id = ?", item.id); this.sql.exec("DELETE FROM media_chunks WHERE upload_id = ?", item.id); }
    await this.ctx.storage.setAlarm(Math.min(room.createdAt + ROOM_TTL_MS, now + 600000));
  }
  async beginUpload(request) {
    const room = this.requireRoom();
    if (!room || !this.hostMatches(room, request)) return json({ error: "Invalid room or host authorization." }, 403);
    const body = await request.json().catch(() => null);
    if (!body || !allowedMedia(body.name, body.mime)) return json({ error: "Only MP3 and WAV uploads are supported in the public beta." }, 415);
    const bytes = Number(body.bytes), sha256 = String(body.sha256 || "").toLowerCase();
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_TRACK_BYTES) return json({ error: "Track must be 1 byte to 25 MiB." }, 413);
    if (!/^[a-f0-9]{64}$/.test(sha256)) return json({ error: "Invalid SHA-256 digest." }, 400);
    const now = Date.now(); room.trackUploads = (room.trackUploads || []).filter(t => now - t < 3600000);
    if (room.trackUploads.length >= MAX_UPLOADS_PER_HOUR) return json({ error: "Room upload quota reached for this hour." }, 429);
    const uploadId = randomHex(24), meta = { name: safeName(body.name), mime: canonicalMime(body.name), bytes: bytes, sha256: sha256, chunkSize: CHUNK_BYTES, chunkCount: Math.ceil(bytes / CHUNK_BYTES) };
    this.sql.exec("INSERT INTO upload_sessions (id, payload, created_at) VALUES (?, ?, ?)", uploadId, JSON.stringify(meta), now);
    await this.ctx.storage.setAlarm(Math.min(room.createdAt + ROOM_TTL_MS, now + 600000));
    return json({ uploadId: uploadId, chunkSize: CHUNK_BYTES, chunkCount: meta.chunkCount, maxBytes: MAX_TRACK_BYTES }, 201);
  }
  async putChunk(request, uploadId, index) {
    const room = this.requireRoom();
    if (!room || !this.hostMatches(room, request)) return json({ error: "Invalid room or host authorization." }, 403);
    const row = this.sql.exec("SELECT payload FROM upload_sessions WHERE id = ?", uploadId).toArray()[0];
    if (!row) return json({ error: "Upload session expired. Start the upload again." }, 404);
    const meta = JSON.parse(row.payload);
    if (!Number.isInteger(index) || index < 0 || index >= meta.chunkCount) return json({ error: "Invalid chunk index." }, 400);
    const bytes = new Uint8Array(await request.arrayBuffer()), expected = index === meta.chunkCount - 1 ? meta.bytes - index * meta.chunkSize : meta.chunkSize;
    if (bytes.byteLength !== expected) return json({ error: "Invalid chunk size." }, 400);
    const previous = this.sql.exec("SELECT body FROM media_chunks WHERE upload_id = ? AND chunk_index = ?", uploadId, index).toArray()[0];
    if (previous) {
      const old = previous.body instanceof Uint8Array ? previous.body : new Uint8Array(previous.body);
      if (old.byteLength === bytes.byteLength && old.every((value, i) => value === bytes[i])) return new Response(null, { status: 204 });
      return json({ error: "Conflicting payload already exists at this chunk index." }, 409);
    }
    this.sql.exec("INSERT INTO media_chunks (upload_id, chunk_index, body) VALUES (?, ?, ?)", uploadId, index, bytes);
    return new Response(null, { status: 204 });
  }
  async completeUpload(request, uploadId) {
    const room = this.requireRoom();
    if (!room || !this.hostMatches(room, request)) return json({ error: "Invalid room or host authorization." }, 403);
    const session = this.sql.exec("SELECT payload FROM upload_sessions WHERE id = ?", uploadId).toArray()[0];
    if (!session) return json({ error: "Upload session expired." }, 404);
    const meta = JSON.parse(session.payload), chunks = this.sql.exec("SELECT chunk_index, body FROM media_chunks WHERE upload_id = ? ORDER BY chunk_index", uploadId).toArray();
    if (chunks.length !== meta.chunkCount) return json({ error: "Upload incomplete: received " + chunks.length + "/" + meta.chunkCount + " chunks." }, 409);
    const joined = new Uint8Array(meta.bytes); let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (Number(chunks[i].chunk_index) !== i) return json({ error: "Upload has a missing chunk." }, 409);
      const chunk = chunks[i].body instanceof Uint8Array ? chunks[i].body : new Uint8Array(chunks[i].body);
      joined.set(chunk, offset); offset += chunk.byteLength;
    }
    if (offset !== meta.bytes) return json({ error: "Uploaded byte count mismatch." }, 400);
    const digestBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
    const digest = Array.from(digestBytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    if (digest !== meta.sha256) {
      this.sql.exec("DELETE FROM upload_sessions WHERE id = ?", uploadId); this.sql.exec("DELETE FROM media_chunks WHERE upload_id = ?", uploadId);
      return json({ error: "SHA-256 verification failed. Upload was rejected." }, 422);
    }
    const track = { id: digest, url: "/media/" + room.id + "/" + uploadId, token: uploadId, name: meta.name, mime: meta.mime, bytes: meta.bytes, sha256: digest, durationSec: null };
    const duplicate = (room.queue || []).find(t => t.sha256 === digest); if (duplicate) track.durationSec = duplicate.durationSec || null;
    room.queue = Array.isArray(room.queue) ? room.queue : []; room.queue.push(track); room.queueIndex = room.queue.length - 1;
    room.track = track; room.trackGeneration++; room.state = "ready"; room.position = room.startPosition = 0;
    room.startAt = room.startedAt = room.pauseAt = room.stopAt = null; room.pausePosition = room.stopPosition = null; room.pendingSeek = null; room.trackUploads.push(Date.now());
    this.sql.exec("DELETE FROM upload_sessions WHERE id = ?", uploadId);
    this.bump(room, true); this.saveRoom(room);
    for (const peer of this.clients(room)) {
      peer.a.readyTrackId = null; peer.a.info.audioReady = false; peer.a.info.audioEnabled = false; peer.a.info.clockLocked = false; peer.a.info.clockSampleCount = 0;
      peer.a.info.bufferSec = 0; peer.a.info.syncErrorMs = 0; peer.a.info.status = "preparing"; this.writeAttachment(peer.ws, peer.a);
    }
    this.broadcast(room, { type: "trackOffer", revision: room.revision, timelineEpoch: room.timelineEpoch, trackGeneration: room.trackGeneration, track: track });
    this.broadcastSnapshot(room); return json(track, 201);
  }
  async serveMedia(request, token) {
    const room = this.requireRoom(); if (!room) return new Response(null, { status: 404 });
    const track = (room.queue || []).find(t => t.token === token); if (!track) return new Response(null, { status: 404 });
    const size = Number(track.bytes) || 0, range = request.headers.get("range");
    let start = 0, end = size - 1, status = 200;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
      if (!match[1]) {
        const suffix = Number(match[2] || 0);
        if (!Number.isSafeInteger(suffix) || suffix < 1) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
        start = Math.max(0, size - suffix); end = size - 1;
      } else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1; }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
      end = Math.min(end, size - 1); status = 206;
    }
    const first = Math.floor(start / CHUNK_BYTES), last = Math.floor(end / CHUNK_BYTES);
    const rows = this.sql.exec("SELECT chunk_index, body FROM media_chunks WHERE upload_id = ? AND chunk_index >= ? AND chunk_index <= ? ORDER BY chunk_index", token, first, last).toArray();
    const total = end - start + 1, body = new Uint8Array(total); let written = 0;
    for (const row of rows) {
      const idx = Number(row.chunk_index), chunk = row.body instanceof Uint8Array ? row.body : new Uint8Array(row.body);
      const globalStart = idx * CHUNK_BYTES, from = Math.max(start - globalStart, 0), to = Math.min(end - globalStart + 1, chunk.byteLength);
      if (to > from) { body.set(chunk.subarray(from, to), written); written += to - from; }
    }
    if (written !== total) return json({ error: "Media is incomplete or expired." }, 503);
    const headers = { "content-type": track.mime || "application/octet-stream", "accept-ranges": "bytes", "cache-control": "private, max-age=600", "content-length": String(total) };
    if (status === 206) headers["content-range"] = "bytes " + start + "-" + end + "/" + size;
    return request.method === "HEAD" ? new Response(null, { status: status, headers: headers }) : new Response(body, { status: status, headers: headers });
  }
  async diagnostics(request) {
    const room = this.requireRoom();
    if (!room || !this.hostMatches(room, request)) return json({ error: "Invalid host authorization." }, 403);
    const payload = { exportedAt: Date.now(), protocolVersion: PROTOCOL_VERSION, room: this.snapshot(room), limitations: ["Software telemetry is not acoustic measurement.", "Output and acoustic latency require physical instrumentation."] };
    if (new URL(request.url).searchParams.get("format") === "csv") {
      const cols = ["id","name","role","transport","rttMs","clockJitterMs","clockUncertaintyMs","clockDriftPpm","syncErrorMs","outputLatencyMs","trimMs","bufferSec","syncConfidence","status"];
      const csv = [cols.join(","), ...payload.room.devices.map(d => cols.map(k => JSON.stringify(d[k] ?? "")).join(","))].join("\n");
      return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=sonicsync-" + room.id + "-diagnostics.csv", "cache-control": "no-store" } });
    }
    return json(payload, 200, { "content-disposition": "attachment; filename=sonicsync-" + room.id + "-diagnostics.json" });
  }
}
