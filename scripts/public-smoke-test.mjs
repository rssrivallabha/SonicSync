import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import WebSocket from "ws";

const PORT = Number(process.env.SONICSYNC_PUBLIC_TEST_PORT || 8799);
const BASE = "http://127.0.0.1:" + PORT;
const CONFIG = "cloudflare/wrangler.jsonc";
const WAIT_MS = 12_000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = { stdout: [], stderr: [] };

function collect(stream, target) {
  stream?.on("data", chunk => {
    target.push(String(chunk));
    if (target.length > 120) target.shift();
  });
}
async function waitUntilHealthy(child) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Wrangler exited during startup.\n" + output.stdout.join("") + "\n" + output.stderr.join(""));
    try {
      const response = await fetch(BASE + "/api/health", { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const payload = await response.json();
        assert.equal(payload.backendMode, "public");
        return payload;
      }
      lastError = new Error("Health endpoint returned " + response.status);
    } catch (error) { lastError = error; }
    await sleep(350);
  }
  throw new Error("Wrangler did not become healthy: " + String(lastError) + "\n" + output.stdout.join("") + "\n" + output.stderr.join(""));
}
function openSocket(room) {
  const ws = new WebSocket("ws://127.0.0.1:" + PORT + "/?room=" + encodeURIComponent(room));
  const backlog = [];
  const waiters = [];
  ws.on("message", raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    const index = waiters.findIndex(waiter => waiter.match(message));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else backlog.push(message);
  });
  ws.on("error", error => {
    for (const waiter of [...waiters]) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    waiters.length = 0;
  });
  return {
    ws,
    opened: new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try { ws.terminate(); } catch {}
        reject(new Error("Timed out opening public room WebSocket. Check the Worker upgrade route and Durable Object socket handoff."));
      }, 8000);
      ws.once("open", () => { clearTimeout(timer); resolve(); });
      ws.once("error", error => { clearTimeout(timer); reject(error); });
      ws.once("close", (code, reason) => {
        clearTimeout(timer);
        reject(new Error("WebSocket closed before opening (" + code + "): " + reason.toString()));
      });
    }),
    send(message) {
      if (ws.readyState !== WebSocket.OPEN) throw new Error("WebSocket is not open.");
      ws.send(JSON.stringify(message));
    },
    waitFor(type, predicate = () => true, timeout = WAIT_MS) {
      const match = message => message.type === type && predicate(message);
      const index = backlog.findIndex(match);
      if (index >= 0) return Promise.resolve(backlog.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { match, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error("Timed out waiting for WebSocket message: " + type + "\nRecent messages: " + JSON.stringify(backlog.slice(-10))));
        }, timeout);
        waiters.push(waiter);
      });
    },
    close() { try { ws.close(1000, "Smoke test complete"); } catch {} }
  };
}
async function jsonRequest(path, init) {
  const response = await fetch(BASE + path, init);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { response, body };
}
function hostHeaders(room, hostToken) {
  return { "X-SonicSync-Room": room, "X-SonicSync-Host": hostToken };
}

let child;
let host;
let speaker;
let result = "not completed";
try {
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  child = spawn(executable, [
    "exec", "--", "wrangler", "--config", CONFIG, "dev",
    "--ip", "127.0.0.1", "--port", String(PORT)
  ], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } });
  collect(child.stdout, output.stdout);
  collect(child.stderr, output.stderr);

  const health = await waitUntilHealthy(child);
  console.log("PASS local Worker starts and reports public mode:", health.version);

  const created = await jsonRequest("/api/room", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const { id: room, hostToken } = created.body;
  assert.match(room, /^[A-Z0-9]{6}$/);
  assert.match(hostToken, /^[a-f0-9]{64}$/);
  console.log("PASS room creation and host token");

  host = openSocket(room);
  await host.opened;
  host.send({ type: "join", room, role: "host", name: "CI Host", hostToken });
  const hostWelcome = await host.waitFor("welcome");
  assert.equal(hostWelcome.role, "host");

  speaker = openSocket(room);
  await speaker.opened;
  speaker.send({ type: "join", room, role: "client", name: "CI Speaker" });
  const speakerWelcome = await speaker.waitFor("welcome");
  assert.equal(speakerWelcome.role, "client");
  console.log("PASS host + participant WebSocket join");

  const fixture = await readFile(new URL("../test/fixtures/smoke.wav", import.meta.url));
  const sha256 = createHash("sha256").update(fixture).digest("hex");
  const headers = { ...hostHeaders(room, hostToken), "Content-Type": "application/json" };
  const begin = await jsonRequest("/api/public-upload/" + room + "/begin", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "public-smoke.wav", mime: "audio/wav", bytes: fixture.byteLength, sha256 })
  });
  assert.equal(begin.response.status, 201, JSON.stringify(begin.body));
  const chunkSize = begin.body.chunkSize;
  for (let index = 0; index < begin.body.chunkCount; index++) {
    const start = index * chunkSize;
    const chunk = fixture.subarray(start, Math.min(fixture.byteLength, start + chunkSize));
    const uploaded = await fetch(BASE + "/api/public-upload/" + room + "/" + begin.body.uploadId + "/" + index, {
      method: "PUT",
      headers: { ...hostHeaders(room, hostToken), "Content-Type": "application/octet-stream" },
      body: chunk
    });
    assert.equal(uploaded.status, 204, "Chunk " + index + " upload failed: " + uploaded.status + " " + await uploaded.text());
  }
  const complete = await jsonRequest("/api/public-upload/" + room + "/" + begin.body.uploadId + "/complete", {
    method: "POST",
    headers: hostHeaders(room, hostToken)
  });
  assert.equal(complete.response.status, 201, JSON.stringify(complete.body));
  assert.equal(complete.body.sha256, sha256);

  const hostOffer = await host.waitFor("trackOffer", m => m.track?.sha256 === sha256);
  const speakerOffer = await speaker.waitFor("trackOffer", m => m.track?.sha256 === sha256);
  assert.equal(hostOffer.track.token, begin.body.uploadId);
  assert.equal(speakerOffer.track.id, sha256);
  console.log("PASS chunked WAV upload, digest verification, and track broadcast");

  const ranged = await fetch(BASE + complete.body.url, { headers: { Range: "bytes=0-15" } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), "bytes 0-15/" + fixture.byteLength);
  const firstBytes = new Uint8Array(await ranged.arrayBuffer());
  assert.deepEqual(firstBytes, new Uint8Array(fixture.subarray(0, 16)));
  console.log("PASS HTTP Range media response");

  const ready = {
    type: "ready", trackId: sha256, audioReady: true, audioEnabled: true, clockLocked: true,
    clockSampleCount: 8, bufferSec: 5, durationSec: 2, outputLatencyMs: 18, baseLatencyMs: 5
  };
  host.send(ready);
  speaker.send({ ...ready, audioEnabled: false });
  await Promise.all([host.waitFor("readyAck"), speaker.waitFor("readyAck")]);
  host.send({ type: "start", leadMs: 2000 });
  const [hostSchedule, speakerSchedule] = await Promise.all([
    host.waitFor("schedule"), speaker.waitFor("schedule")
  ]);
  assert.equal(hostSchedule.effectiveAt, speakerSchedule.effectiveAt);
  assert.ok(hostSchedule.effectiveAt > Date.now());
  console.log("PASS one future timeline anchor starts even with participant audio gate pending");

  await Promise.all([host.waitFor("playing", () => true, 12_000), speaker.waitFor("playing", () => true, 12_000)]);
  host.send({ type: "pause" });
  await host.waitFor("pauseScheduled");
  await Promise.all([host.waitFor("paused", () => true, 8000), speaker.waitFor("paused", () => true, 8000)]);
  const pausedSnapshot = await jsonRequest("/api/room/" + room + "/diagnostics", { headers: { "X-SonicSync-Host": hostToken } });
  assert.notEqual(pausedSnapshot.response.status, 403);
  host.send({ type: "resume" });
  const [hostResume, speakerResume] = await Promise.all([host.waitFor("schedule"), speaker.waitFor("schedule")]);
  assert.ok(hostResume.position > 0, "Resume anchor incorrectly reset to zero.");
  assert.equal(hostResume.effectiveAt, speakerResume.effectiveAt);
  console.log("PASS scheduled play, pause, and resume from retained position");
  result = "PASS public Worker smoke";
  console.log(result);
} catch (error) {
  console.error("FAIL public Worker smoke:", error?.stack || error);
  console.error("Wrangler stdout:\n" + output.stdout.join(""));
  console.error("Wrangler stderr:\n" + output.stderr.join(""));
  process.exitCode = 1;
} finally {
  try { host?.close(); } catch {}
  try { speaker?.close(); } catch {}
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit").catch(() => {}), sleep(4000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
if (result !== "PASS public Worker smoke" && !process.exitCode) process.exitCode = 1;
