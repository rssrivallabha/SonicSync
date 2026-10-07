# SonicSync Architecture Decision Record

## Status
Phase 1 audit baseline — repository is empty.

## Audit evidence
Repository: rssrivallabha/SonicSync
Default branch: main
GitHub repository size: 0
Contents API: 404 with GitHub response "This repository is empty."

## Finding A-001 — No implementation exists in repository
There are no source files, manifests, tests, CI workflows, native projects, server, web app, protocol implementation, sync engine, media pipeline, hardware firmware, schematics, or deployment assets to inspect in the target repository.

### Consequence
The implementation state is effectively pre-foundation. No existing architecture can be considered correct or salvageable from this repository.

### Decision
Establish a clean, authoritative monorepo architecture directly from the production specification. Do not fabricate an audit of nonexistent code.

## Finding A-002 — External prototype history is not repository evidence
The supplied engineering specification records historical v2/v3/v4/v5/v9 issues, but those are specification context rather than files currently present in the repository.

### Decision
Carry those known failure modes into the initial risk register and test plan, but label them as historical/specification evidence until reproduced against code.

## Finding A-003 — Physical timing must be separated from software telemetry
The architecture must expose explicit hardware measurement hooks from the beginning. Software-reported timing is not treated as acoustic ground truth.

## Target architecture
apps/
  web/
  android/
  ios/
  windows/
  macos/
  linux/
core/
  sync/
  transport/
  protocol/
  media/
  security/
server/
hardware/
  firmware/
  schematics/
  fixtures/
tests/
benchmarks/
docs/
scripts/
CI/
deployment/

## Phase-1 architectural authority
The sync core owns timeline math, clock estimation, phase error, drift, uncertainty, and correction policy.
Transport implementations own discovery and packet delivery.
Audio platform implementations own decode/output scheduling and route characteristics.
UI consumes state and commands but does not implement synchronization math.
Hardware nodes expose deterministic playback and measurement interfaces.

## Decisions to preserve across future phases
1. Network arrival never directly determines playback.
2. PLAY/PAUSE/RESUME/STOP/SEEK are authoritative timeline operations.
3. roomEpoch, timelineEpoch, trackGeneration, and commandRevision guard stale work.
4. Clock offset is distinct from playback phase error.
5. Native timing is preferred for production playback; browser mode is a fallback.
6. Hardware measurements are required before any hard synchronization-performance claim.
