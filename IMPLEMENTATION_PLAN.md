# SonicSync Implementation Plan

## Phase 1 — Audit & Foundation

### Completed in audit pass
- Confirmed target repository is empty.
- Confirmed default branch is main.
- Confirmed no files are currently available through GitHub contents API.
- Established that Phase 1 must create the foundation rather than modify an existing implementation.

### Immediate build order
1. Establish monorepo layout.
2. Add repository-level engineering rules.
3. Add TypeScript workspace and shared tooling.
4. Create protocol definitions and versioning.
5. Create platform-independent sync-core.
6. Create deterministic state machine and authoritative timeline model.
7. Add simulation tests for timeline, epochs, revisions, clock math, and phase-error aggregation.
8. Add a minimal local host/participant transport harness.
9. Add diagnostics schema.
10. Add hardware-node interface contracts.
11. Add CI for lint/typecheck/unit/integration checks.
12. Document all current limitations.

## Phase 1 exit criteria
- Repository builds.
- Core math tests pass.
- Stale command/epoch guards are covered.
- No browser timer is authoritative for timeline state.
- Protocol messages are versioned.
- Hardware measurement hooks exist as interfaces/contracts.
- CI executes automatically.
- Remaining platform and physical blockers are explicit.

## Subsequent phases
Phase 2: synchronization convergence and playback scheduler.
Phase 3: media distribution and transport implementations.
Phase 4: resilience and security.
Phase 5: web/PWA fallback.
Phase 6: Android native.
Phase 7: iOS native.
Phase 8: desktop native.
Phase 9: dedicated hardware node.
Phase 10: calibration and measurement.
Phase 11: performance and 50 m characterization.
Phase 12: release/deployment.

## Completion rule
A component is complete only when implemented, integrated, tested, measured where measurable, failure-handled, and documented.
