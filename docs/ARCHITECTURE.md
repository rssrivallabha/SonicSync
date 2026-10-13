# SonicSync v10 Architecture

## Runtime planes

```text
                    HOST
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
       CONTROL       MEDIA       TIMING
          │           │           │
          │      HTTP Range       │
          │      + SHA-256       │
          │           │           │
          └───────────┼───────────┘
                      ▼
                SPEAKER NODE
                      │
        local cache → decode → READY
                      │
        room clock → scheduler → output
                      │
                 DAC / speaker
```

## Authoritative state

The room holds track, queue, state, position, volume, mute, timeline epoch, revision and track generation. Playback targets a future timestamp instead of a local timer deadline.

## Sync core

`src/core/clock.mjs` implements NTP-style sampling, robust filtering, drift estimation, uncertainty/confidence and adaptive lead time.

`src/core/timeline.mjs` implements authoritative position extrapolation, phase-error measurement and bounded rate correction.

`src/core/state-machine.mjs` defines the explicit lifecycle and generation invalidation used by native implementations and tests.

`src/core/protocol.mjs` validates control packets and defines the v2 protocol version.

## Media plane

Audio is stored content-addressed by SHA-256. Browser playback uses HTTP Range requests and local Web Audio/HTML media decoding. The audio samples are not transported through WebSocket control during normal music playback.

## Failure model

State-changing commands increment revision and timeline epoch. The client also guards the audio source by source generation. Reconnects rebuild the clock model. Host disappearance forces participant safe-state handling instead of blindly continuing an unbounded stale session.

## Platform boundary

The current runnable target is browser/LAN. Native audio and nearby transport are separated behind the same conceptual contracts so Android/iOS/desktop implementations do not duplicate room/timeline logic.
