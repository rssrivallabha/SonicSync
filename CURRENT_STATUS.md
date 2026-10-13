# CURRENT STATUS — SonicSync v10.0.3 continuation

Date: 2026-10-08

## Verified source snapshot

- 49 static checks pass.
- 13 Node tests pass, including the new bounded phase-PLL tests.
- 21 native/hardware source checks pass.
- 8 measurement/hardware deliverable checks pass.
- Node/script syntax pass.
- Deterministic performance matrix pass.

## Important runtime fixes in this snapshot

1. Room-wide playback no longer requires every participant's browser/OS audio gate to be enabled. The barrier is local media readiness + clock readiness; each participant still needs its own first-time audio activation before audible output.
2. Resume now preserves the retained timeline position through the armed-to-playing transition. The server anchors `startedAt` as `startAt - retainedPosition`, preventing resume from silently restarting at zero.
3. Auto drift correction now uses one bounded continuous PLL with filtered phase error and a leaky integral term. Corrections are applied on the audio playback rate at 120 ms control cadence; hard re-anchor is reserved for errors >80 ms.
4. Automatic direct re-lock uses a shorter bounded lead than the previous 1.8 s minimum path, reducing recovery latency without scheduling in the past.
5. Rate correction is exported as telemetry so diagnostics can distinguish phase error from the actuator applied to correct it.

## Evidence boundary

The simulation values in `artifacts/performance-matrix.json` are software phase-error results only. They do not establish output latency, acoustic error, or node-to-node acoustic skew. Those still require the physical GPIO/audio fixture.

## Open gates

- npm registry/runtime package installation in the model environment.
- Real LAN WebSocket smoke test on a machine with installed dependencies.
- Android/iOS target runtime validation.
- Windows/macOS target runtime validation.
- ESP-IDF firmware build/flash.
- Physical acoustic calibration and 1–50 m validation.
