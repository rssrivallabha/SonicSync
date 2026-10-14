# Public Release Acceptance Checklist

Use this checklist as an implementation gate. A section is not complete until code is implemented, integrated, tested, failure-handled, and documented.

## Phase 0 — Product and deployment contract
- [x] Define the makeshift-speaker user flow
- [x] Preserve the local/offline mode as a separate deployment target
- [x] Set an explicit free-first/no-card approval rule
- [x] Define public beta limitations and sync evidence boundaries
- [x] Fix public base URL construction helper
- [ ] Add automated hosted-origin URL tests

## Phase 1 — Public room coordination
- [ ] Add Cloudflare Worker route handlers for config, health, time, create-room and room WebSocket traffic
- [ ] Add one SQLite Durable Object per room
- [ ] Persist room timeline/track/queue state
- [ ] Implement host-token authorization, room join, snapshot, RTC signal relay, telemetry and ready messages
- [ ] Implement play, pause, resume, stop/hold, reset, seek, volume, mute, queue, kick and room-lock semantics
- [ ] Implement room expiry and quota-safe cleanup

## Phase 2 — Public audio media
- [ ] Implement upload begin/chunk/complete with strict size and count checks
- [ ] Verify SHA-256 before a track can be broadcast as ready-to-prepare
- [ ] Serve media with correct HEAD/Range/206/416 behavior
- [ ] Add chunk retry/progress and cleanup for interrupted uploads
- [ ] Keep the existing local multipart uploader unchanged for server.js

## Phase 3 — Frontend integration
- [ ] Connect public mode through /ws?room=... while preserving local mode
- [ ] Add a public backend mode flag to /api/config
- [ ] Preserve local audio activation semantics and differentiate media readiness from audioEnabled
- [ ] Use a public base URL for room links and QR codes
- [ ] Make offline/transport and storage limitations visible to users

## Phase 4 — Security and resilience
- [ ] Rate limits for room creation, join attempts, uploads and WebSockets
- [ ] Host token protection and no-store cache headers for sensitive responses
- [ ] Oversized/malformed packet tests
- [ ] Upload digest mismatch, missing chunk, duplicate chunk and stale upload tests
- [ ] Host disconnect/rejoin and stale epoch tests
- [ ] Public abuse/quota tests and user-readable failure messages

## Phase 5 — Release evidence
- [ ] Unit tests for room/timeline transitions
- [ ] Integration test for one host + two participant sockets
- [ ] Public smoke test: create → join → upload → prepare → clock sync → scheduled play → pause/resume → seek → cleanup
- [ ] Cross-browser manual tests on Chromium/Android and Safari/iOS
- [ ] Two or more real devices on different networks
- [ ] Capture clock offset, drift, uncertainty, playback error, output latency and acoustic skew separately
- [ ] Document actual test date/device/browser/results
- [ ] Do not claim sub-ms acoustic synchronization without physical measurement
- [ ] Confirm the deployment can remain on free tier without card/payment details before inviting the public

## Exit criteria
A public beta may be labelled **limited beta** only when the public smoke test and at least one multi-device test pass, failed uploads cannot corrupt playable tracks, and the free-tier resource caps are enforced. It must not be described as production-grade acoustic sync until physical measurements support that claim.
