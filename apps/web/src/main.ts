import { ClockModel } from "../../../core/sync/src/index.js";
import { WebAudioEngine } from "./audio-engine.js";

const root = document.getElementById("app");
if (!root) throw new Error("app root missing");

const clock = new ClockModel();
const audio = new WebAudioEngine();

root.innerHTML = `
  <main style="font-family:Inter,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:24px">
    <h1>SonicSync</h1>
    <p>Browser fallback — native timing guarantees are not implied.</p>
    <button id="unlock">Enable Audio</button>
    <pre id="status">Audio: locked\nClock: unlocked</pre>
  </main>
`;

document.getElementById("unlock")?.addEventListener("click", async () => {
  await audio.unlock();
  document.getElementById("status")!.textContent = `Audio: ${audio.currentTimeSeconds.toFixed(3)}\nClock: ${clock.isLocked() ? "locked" : "unlocked"}`;
});
