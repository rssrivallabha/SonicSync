import fs from "node:fs";
import assert from "node:assert/strict";
const worker = fs.readFileSync(new URL("../cloudflare/worker.js", import.meta.url), "utf8");
const wrangler = JSON.parse(fs.readFileSync(new URL("../cloudflare/wrangler.jsonc", import.meta.url), "utf8"));
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const expectedPublicRegex = "if (!/" + String.fromCharCode(92) + ".(mp3|wav)$/i.test(file.name))";
const hasRoomBinding = (wrangler.durable_objects?.bindings || []).some(b => b.name === "ROOMS" && b.class_name === "RoomCoordinator");
const hasSqliteMigration = (wrangler.migrations || []).some(m => (m.new_sqlite_classes || []).includes("RoomCoordinator"));
const checks = [
  ["browser defines the telemetry loop", app.includes("function startTelemetryLoop()") && app.includes("state.telemetryTimer = setInterval(publish, intervalMs)")],
  ["public clock cadence is quota-aware", app.includes("const refreshEveryMs = publicMode ? 3000 : 500") && app.includes("state.backendMode = config.backendMode === \"public\" ? \"public\" : \"local\"")],
  ["readiness publication is deduplicated", app.includes("readinessSignature === state.lastReadySignature")],
  ["public direct RTC has STUN without changing offline ICE", app.includes('state.backendMode === "public" ? [{ urls: "stun:stun.l.google.com:19302" }] : []')],
  ["telemetry fanout avoids repetitive SQLite writes", !worker.slice(worker.indexOf('if (m.type === "telemetry")'), worker.indexOf('if (m.type === "ready")', worker.indexOf('if (m.type === "telemetry")'))).includes("saveRoom(room)")],
  ["public room bounds", worker.includes("const MAX_CLIENTS = 8;") && worker.includes("const ROOM_TTL_MS = 4 * 60 * 60 * 1000;")],
  ["health route", worker.includes('path === "/api/health"')],
  ["public backend mode", worker.includes('backendMode: "public"')],
  ["public asset routing runs Worker first", wrangler.assets?.run_worker_first === true],
  ["public room Durable Object binding", hasRoomBinding],
  ["SQLite Durable Object migration", hasSqliteMigration],
  ["unique room lifecycle handlers", ["webSocketClose","webSocketError","alarm","beginUpload","putChunk","completeUpload","serveMedia","diagnostics"].every(name => worker.split("async " + name + "(").length === 2)],
  ["Durable Object receives original WebSocket request", worker.includes('return this.openSocket(request);')],
  ["room-scoped WebSocket routing", worker.includes('url.searchParams.get("room")') && app.includes("wsUrl(room)")],
  ["chunked upload endpoints", worker.includes("/_internal/upload/begin") && worker.includes("async putChunk")],
  ["server-side SHA-256 verification", worker.includes('crypto.subtle.digest("SHA-256", joined)')],
  ["HTTP byte-range media", worker.includes('headers["content-range"]')],
  ["public room-creation rate limit", worker.includes("MAX_ROOMS_PER_HOUR = 5")],
  ["room join attempt rate limit", worker.includes("/_internal/rate/join") && worker.includes("async rateJoin")],
  ["randomized high-entropy room code", worker.includes("function randomRoomCode()")],
  ["room connection cap", worker.includes("this.ctx.getWebSockets().length >= MAX_CLIENTS * 2")],
  ["host authorization on upload paths", worker.includes("this.hostMatches(room, request)")],
  ["bounded per-room media quota", worker.includes("MAX_ROOM_MEDIA_BYTES = 100 * 1024 * 1024")],
  ["bounded per-track media cap", worker.includes("MAX_TRACK_BYTES = 25 * 1024 * 1024")],
  ["shared adaptive lead core", worker.includes("coreAdaptiveLeadMs") && worker.includes("../src/core/clock.mjs")],
  ["playback requires true clock lock", worker.includes("summary.clockLocked < summary.total")],
  ["public asset security headers", worker.includes("content-security-policy") && worker.includes("x-content-type-options")],
  ["local multipart upload preserved", app.includes('api("/api/upload"') && server.includes('app.post("/api/upload"')],
  ["public upload accepts MP3/WAV", app.includes(expectedPublicRegex) && worker.includes('return ext === "mp3" || ext === "wav";')],
  ["local backend mode marked", server.includes('backendMode: "local"')],
  ["hosted URL helper used", server.includes("joinBase: publicBaseUrl(req)")]
];
for (const [name, ok] of checks) { assert.ok(ok, name); console.log("PASS", name); }
console.log("All " + checks.length + " public-mode source checks passed.");
