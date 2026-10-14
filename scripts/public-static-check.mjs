import fs from "node:fs";
import assert from "node:assert/strict";
const worker = fs.readFileSync(new URL("../cloudflare/worker.js", import.meta.url), "utf8");
const wrangler = fs.readFileSync(new URL("../cloudflare/wrangler.jsonc", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const checks = [
  ["health route", worker.includes('path === "/api/health"')],
  ["public backend mode", worker.includes('backendMode: "public"')],
  ["public rooms use SQLite Durable Objects", wrangler.includes('"class_name": "RoomCoordinator"') && wrangler.includes('"new_sqlite_classes": ["RoomCoordinator"]')],
  ["room-scoped WebSocket routing", worker.includes('url.searchParams.get("room")') && app.includes("wsUrl(room)")],
  ["chunked upload endpoints", worker.includes("/_internal/upload/begin") && worker.includes("async putChunk")],
  ["server-side SHA-256 verification", worker.includes('crypto.subtle.digest("SHA-256", joined)')],
  ["HTTP byte-range media", worker.includes('headers["content-range"]')],
  ["public room-creation rate limit", worker.includes("MAX_ROOMS_PER_HOUR = 5")],
  ["room join attempt rate limit", worker.includes("/_internal/rate/join") && worker.includes("async rateJoin")],
  ["host authorization on upload paths", worker.includes("this.hostMatches(room, request)")],
  ["bounded per-room media quota", worker.includes("MAX_ROOM_MEDIA_BYTES = 100 * 1024 * 1024")],
  ["bounded per-track media cap", worker.includes("MAX_TRACK_BYTES = 25 * 1024 * 1024")],
  ["shared adaptive lead core", worker.includes("coreAdaptiveLeadMs") && worker.includes("../src/core/clock.mjs")],
  ["public asset security headers", worker.includes("content-security-policy") && worker.includes("x-content-type-options")],
  ["local multipart upload preserved", app.includes('api("/api/upload"') && server.includes('app.post("/api/upload"')],
  ["public upload accepts MP3/WAV", app.includes('if (!/\.(mp3|wav)$/i.test(file.name))') && worker.includes("Only MP3 and WAV uploads are supported")],
  ["local backend mode marked", server.includes('backendMode: "local"')],
  ["hosted URL helper trims paths", server.includes("function publicBaseUrl(req)") && server.includes("PUBLIC_BASE_URL")]
];
for (const [name, ok] of checks) { assert.ok(ok, name); console.log("PASS", name); }
console.log("All " + checks.length + " public-mode source checks passed.");
