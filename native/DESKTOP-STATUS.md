# Desktop Native Track — v10

Status: **source implemented; integration-ready; platform build must run on the target OS**.

| OS | Output backend | Capture boundary |
|---|---|---|
| Windows | WASAPI shared render event stream | WASAPI loopback / application-loopback extension point |
| macOS | CoreAudio default output AudioUnit | CoreAudio input/system-mix extension point |
| Linux | PipeWire stream | PipeWire capture extension point |

The Windows design follows the native WASAPI contract; Microsoft documents loopback capture for the rendered endpoint and a newer 2026 sample for process-scoped application loopback. citeturn836657search0turn836657search3

PipeWire is used directly on Linux because its current documentation emphasizes realtime scheduling and low-latency processing. citeturn836657search2turn836657search7
