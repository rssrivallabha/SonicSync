import { ClockModel } from "../../../core/sync/src/index.js";
import { detectBrowserAudioCapabilities } from "./capabilities.js";
import { WebAudioEngine } from "./audio-engine.js";

const root = document.getElementById("app");
if (!root) throw new Error("app root missing");

const clock = new ClockModel();
const audio = new WebAudioEngine();
const capabilities = detectBrowserAudioCapabilities();

root.innerHTML = `
  <main style="font-family:Inter,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:24px">
    <h1>SonicSync</h1>
    <p>Browser fallback. Native timing guarantees are not implied.</p>
    <button id="unlock" ${capabilities.audioContext ? "" : "disabled"}>Enable Audio</button>
    <pre id="status">Audio: locked
Clock: unlocked
Web Audio: ${capabilities.webAudio ? "available" : "unavailable"}
Output timestamp: ${capabilities.audioOutputTimestamp ? "available" : "unavailable"}</pre>
  </main>
`;

document.getElementById("unlock")?.addEventListener("click", async () => {
  const status = document.getElementById("status");
  try {
    await audio.unlock();
    status!.textContent = `Audio: ${audio.currentTimeSeconds.toFixed(3)}
Clock: ${clock.isLocked() ? "locked" : "unlocked"}
Output timestamp: ${audio.outputTimestamp ? "available" : "unavailable"}`;
  } catch (error) {
    status!.textContent = `Audio: failed
Reason: ${error instanceof Error ? error.message : String(error)}`;
  }
});
