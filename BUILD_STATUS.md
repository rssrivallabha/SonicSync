# BUILD STATUS — SonicSync v10.0.3 continuation

## Build identity

- Project version: 10.0.2
- Track: continuation / release candidate, **not final**
- Verification date: 2026-10-08
- Node verified here: v22.16.0

## Verification

| Gate | Result |
|---|---|
| Static source checks | PASS — 49 |
| Node tests | PASS — 13 |
| Native/hardware source checks | PASS — 21 |
| Measurement deliverables | PASS — 8 |
| Node/script syntax | PASS |
| Deterministic performance matrix | PASS |
| npm install in this environment | BLOCKED — npm registry unreachable |
| LAN WebSocket smoke | OPEN — requires dependencies on the target machine |
| npm start in this environment | BLOCKED — `express` unavailable because install is blocked |

## Hotfix evidence

### Audio gate
The server start/resume barrier now requires every node to have the track decoded and enough clock samples; it no longer requires every node's browser/OS audio gate to be enabled. A participant with a locked audio gate can receive the authoritative timeline and catch up after local activation.

### Resume position
The server now stores an explicit `startPosition` and shifts the playing anchor so `startedAt = startAt - retainedPosition * 1000` for resume. This prevents the previous v10 smoke failure where resume effectively restarted the room at zero.

### Auto drift control
The browser now uses a dedicated bounded phase-PLL core with filtered error, leaky integral control, a ±20,000 ppm actuator limit and a 0.8 ms deadband. The controller updates every 120 ms using monotonic `performance.now()` deltas. Hard re-anchor is reserved for `|phase error| > 80 ms`; smaller errors are corrected by bounded playback-rate adjustment.

### Telemetry
`rateCorrectionPpm` is now exported alongside clock offset, drift, uncertainty, playback error, output latency and sync confidence.

## Claims boundary

No sub-ms acoustic synchronization claim is made. Simulation phase-error numbers are not physical acoustic skew.
