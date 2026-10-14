import fs from "node:fs";
import assert from "node:assert/strict";
const worker = fs.readFileSync(new URL("../cloudflare/worker.js", import.meta.url), "utf8");
const wrangler = fs.readFileSync(new URL("../cloudflare/wrangler.jsonc", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const checks = [
  ["shared adaptive lead core", worker.includes('import { adaptiveLeadMs as coreAdaptiveLeadMs }')],
  ["health route", worker.includes('path === "/api/health"')],
  ["public backend mode", worker.includes('backendMode: "public"')],
  ["room-scoped WebSocket URL", worker.includes('url.searchParams.get("room")')],
  ["Durable Object binding", wrangler.includes('"class_name": "RoomCoordinator"')],
  ["SQLite Durable Object migration", wrangler.includes('"new_sqlite_classes": ["RoomCoordinator"]')],
  ["chunked upload endpoint", worker.includes("/_internal/upload/begin")],
  ["server SHA-256 verification", worker.includes('crypto.subtle.digest("SHA-256", joined)')],
  ["byte range media support", worker.includes('headers["content-range"]')],
  ["per-IP room creation limit", worker.includes("MAX_ROOMS_PER_HOUR = 5")],
  ["client passes room to socket URL", app.includes("wsUrl(room)")],
  ["public upload client", app.includes("uploadPublicTrack(file)")],
  ["local multipart upload retained", app.includes('api("/api/upload"')],
  ["host authorization on uploads", worker.includes("this.hostMatches(room, request)")],
  ["bounded 25 MiB upload cap", worker.includes("MAX_TRACK_BYTES = 25 * 1024 * 1024")],
  ["security headers on public assets", worker.includes('content-security-policy')]
];
for (const [name, ok] of checks) { assert.ok(ok, name); console.log("PASS", name); }
console.log("All " + checks.length + " public-mode source checks passed.");
