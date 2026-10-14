# SonicSync Public Product Plan

## Product goal

Make SonicSync the simplest way to turn nearby phones, tablets, and laptops into a makeshift multi-speaker system. A host creates a room, shares a short code or QR link, uploads an MP3/WAV file, waits for participants to prepare, and starts playback against one authoritative timeline.

The product must be approachable to non-technical users while preserving the engineering discipline required for synchronized audio.

## Target user experience

1. Open the HTTPS app on a supported device.
2. Choose **Create Room** or **Join Room**.
3. The host shares a room code, link, or QR code.
4. The host uploads an MP3/WAV track.
5. Each node downloads and decodes the same content locally and reports readiness.
6. After required first-time audio activation, nodes clock-sync and join the readiness barrier.
7. The host schedules playback at a future shared time.
8. The room exposes honest sync status and gives the host safe retry/recovery controls.

## Product principles

- **Sync correctness before visual polish.** No “play now” control that ignores device readiness or clock uncertainty.
- **Nearby/offline remains first-class.** Keep the current local Node server and its LAN/hotspot workflow. Public mode is an additional deployment target, not a replacement.
- **Local decoding.** WebSocket traffic is for control, signaling, and telemetry; it must not become a continuous music-sample stream.
- **Explicit user activation.** Browsers and mobile operating systems may require a gesture before audio output. Do not pretend this can be bypassed.
- **Honest evidence.** Keep clock offset, clock drift, clock uncertainty, playback phase error, output latency, acoustic error, and node-to-node skew as distinct values. Simulation is not physical measurement.
- **Free-first deployment.** Start on a no-cost plan where the provider permits it. Never add a paid service, paid plan, card verification, or a billable resource without asking the owner first.
- **Privacy by default.** Use unguessable host tokens, validate control messages, rate-limit public endpoints, expire rooms and media, and do not log host tokens or uploaded audio.
- **Progressive compatibility.** Browser/PWA is the first public target. Native Android/iOS/desktop and the hardware reference node remain explicit tracks, with platform evidence recorded separately.

## Release 0: Public beta

### Included
- Public HTTPS landing page and room UI
- Anyone can create a room and join using a room code/link
- Host-authorized MP3/WAV upload with strict size and rate limits
- Local download/cache/decode on each participant
- Shared future playback timeline
- Play, pause, resume, stop/hold, reset, seek, volume/mute, queue/next/previous
- WebSocket room presence/control and WebRTC direct peer signaling where available
- Readiness, clock quality, and playback-error status
- Basic diagnostics export
- Room and media expiry with explicit quota errors

### Not a release promise
- Identical acoustic output across every model of phone
- Sub-millisecond acoustic skew
- Guaranteed 50 m range
- DRM-protected or system audio capture
- Native background playback on all platforms
- Unlimited media uploads or unlimited free public use

## Two operating modes

### Nearby/offline mode
The existing Node.js server remains the local authority. Users connect to the same LAN or host hotspot. Internet is not required once the local setup is available. Bonjour discovery is opportunistic; a room code and reachable local URL remain the fallback.

### Public room mode
A separate edge deployment serves the same web client while assigning each room a durable coordination object. The public coordinator owns room state, WebSocket membership, signaling relay, upload authorization, and media metadata. Audio is stored as bounded chunks in the same room's SQLite-backed Durable Object for the first free-tier prototype, avoiding an R2 subscription requirement. The implementation must enforce caps and expiry because the free storage budget is shared and finite.

## Success criteria

- New visitor can create a room and another device can join without an account.
- Invalid room codes and unauthorized host commands fail safely.
- Uploaded content is size-checked, chunk-checked, and SHA-256 verified before becoming playable.
- A disconnect/reconnect does not duplicate playback or silently reset the timeline.
- Track readiness and audio activation are different states.
- The same synchronization core remains in use for local and public modes.
- The automated smoke test can create, join, upload, prepare, schedule, pause, resume, seek, and clean up a public room.
- Real-device trials record browser/OS/audio route, RTT/jitter, clock uncertainty, playback error, and observed acoustic skew. Claims are based only on the measured evidence.

## Current boundary

The current repository is a working local/LAN-oriented browser pilot with a Node/WebSocket server and a synchronization core. It is not yet a complete public multi-user service: its active room registry is process-local, file uploads and range media reads use a local filesystem, and URL construction has been local-network-centric. The public edge backend and its end-to-end integration are new work, not assumed to exist.
