# Architecture Decision Record

## ADR-001 — Authoritative future timeline
**Decision:** The room owns one shared timeline. Commands carry `timelineEpoch`, `revision`, `effectiveAt`, position and generation metadata.

**Why:** A timer firing "now" on each device turns transport jitter into playback jitter. A future server/host anchor lets every node schedule independently.

## ADR-002 — Preload music before playback
**Decision:** Normal music mode is full-track fetch → SHA-256 verify → local decode/cache → READY barrier → scheduled playback.

**Why:** Network delivery must not be in the critical audio sample path.

## ADR-003 — Direct P2P timing with LAN fallback
**Decision:** WebRTC data channels are preferred for direct host↔speaker timing/control when available; WebSocket/LAN remains the authoritative fallback/signalling layer.

**Why:** Fewer network hops improve timing resilience while preserving compatibility.

## ADR-004 — Monotonic clocks only
**Decision:** Playback math uses monotonic `performance`/audio clocks on the web and platform-native monotonic/audio clocks on native platforms. Wall-clock APIs are not audio clocks.

## ADR-005 — Shared reusable sync core
**Decision:** Clock estimation, timeline math, phase correction, state transitions and protocol validation live in `src/core` as dependency-free modules.

## ADR-006 — Content-addressed media
**Decision:** Stored audio objects are keyed by SHA-256 so identical content can be reused safely across a room and across rooms. Room teardown does not eagerly delete shared objects.

## ADR-007 — Physical truth gate
**Decision:** Software telemetry is explicitly labeled as software evidence. Acoustic skew, DAC-to-speaker latency and sub-ms claims require an external physical measurement fixture.
