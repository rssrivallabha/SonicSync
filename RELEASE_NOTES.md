# SonicSync v10.0.3 — continuation hotfix

This is a continuation build, not the final product.

## Root-cause fixes

- Removed the room-wide audio-enable barrier from host Start/Resume. Media decode and clock readiness remain barriers; local audio activation is handled per device.
- Fixed the armed-to-playing timeline transition so Resume retains the paused/stopped position instead of resetting the room anchor to zero.
- Replaced the previous fixed, slow auto-drift correction loop with a bounded continuous phase PLL.
- Reserved hard re-anchor for large phase errors and reduced automatic direct re-lock lead for faster recovery.
- Added actuator telemetry (`rateCorrectionPpm`).

## Verification

- 49 static checks
- 13 Node tests
- 21 native/hardware source checks
- 8 measurement/hardware deliverable checks
- deterministic performance matrix

## Runtime boundary

The supplied model environment cannot reach the npm registry, so the real LAN smoke test and browser server start still require execution on a machine with dependencies installed. Those gates are not marked passed here.
