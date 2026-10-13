## 10.0.3 — Host audio-gate UX/root-cause fix

- Host Start/Resume controls now use media + clock readiness, not room-wide audioEnabled count.
- Play/Resume itself is the explicit browser user-gesture activation opportunity for host output.
- Remote participant audio gates remain local and do not block the room timeline.
- Diagnostics/UI now distinguish a pending host audio gate from other participant gates.

# CHANGELOG

## v10.0.3 — 2026-10-08

- Fixed room-wide audio gate incorrectly blocking Start/Resume.
- Fixed Resume armed-to-playing transition resetting the authoritative position.
- Added explicit retained `startPosition` timeline anchor.
- Added bounded continuous phase-PLL drift correction with deadband, filtering, integral leak and actuator bounds.
- Raised hard-reanchor threshold to >80 ms and shortened automatic direct recovery lead.
- Added `rateCorrectionPpm` diagnostic telemetry.
- Added smoke coverage for a participant with a pending audio gate and retained resume semantics.
- Added dedicated phase-PLL unit tests to the `npm test` and `npm run validate` gates.

## v10 continuation

- Native Android/iOS/desktop source paths, hardware node scaffold, measurement fixture and deterministic sync simulation.
