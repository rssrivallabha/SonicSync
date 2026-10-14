# SonicSync v10 — Distributed Local Audio

SonicSync is a local distributed-audio platform: one Host controls a shared future timeline while each Speaker Node prepares and renders audio locally. The browser is the fallback surface; native and hardware paths are explicit first-class targets.

## Run the current web product

```bash
npm install
npm run validate
npm run smoke
npm start
```

Open the LAN URL printed by the host. Internet access is not required for the local room path.

## Materially present

- reusable timing core: NTP-style estimation, drift, jitter, uncertainty, confidence and adaptive lead
- authoritative future timeline + revision/epoch/source-generation protections
- SHA-256 content-addressed local media store
- HTTP Range media delivery
- queue controls, shuffle and repeat
- direct WebRTC timing/control with LAN/WebSocket fallback
- iOS/WebKit activation handling and MediaSession support
- JSON/CSV host diagnostics export
- deterministic synchronization simulator and regression tests
- Android native Nearby + Oboe source path
- iOS native Network.framework + AVAudioEngine source path
- Windows WASAPI / macOS CoreAudio / Linux PipeWire desktop source paths
- ESP32-S3 I2S hardware reference node with scheduled start and GPIO timing marker
- physical GPIO timestamp fixture and measurement analyzer

## Native status

Native source code is present and separately documented. It is not represented as target-platform-verified until it is built and exercised on the respective operating system/device. See `CURRENT_STATUS.md`, `native/`, and `docs/NATIVE-BUILD.md`.

## Hardware status

The ESP32-S3 node is a physical timing reference for controlled measurement, not a blanket guarantee of acoustic synchronization. See `hardware/` and `docs/SYNCHRONIZATION_MEASUREMENT.md`.

## Useful commands

```bash
npm run validate
npm run native:check
npm run measurement:check
npm run perf
npm run sim -- --nodes 32 --duration 120 --latency 80 --jitter 25 --drift 120 --loss 0.03
npm run smoke
npm start
```

## Evidence boundary

Always report these separately:

`clock offset` · `clock drift` · `clock uncertainty` · `playback phase error` · `output latency` · `acoustic error` · `node-to-node skew`.

Simulation data and software telemetry are not acoustic measurements. No sub-ms or universal 50 m synchronization claim is valid until the physical measurement fixture produces the evidence.

## Public makeshift-speaker product (in progress)

SonicSync is being developed toward an easy public room experience: create a room, share a code/QR link, upload an MP3/WAV, and let each device prepare and follow the shared timeline. The public hosted backend is a separate deployment target; the existing LAN/offline Node server remains supported.

- Product scope and acceptance: [docs/PUBLIC_PRODUCT_PLAN.md](docs/PUBLIC_PRODUCT_PLAN.md)
- Public mode design: [docs/PUBLIC_MODE_ARCHITECTURE.md](docs/PUBLIC_MODE_ARCHITECTURE.md)
- Release gates: [docs/PUBLIC_ROLLOUT_CHECKLIST.md](docs/PUBLIC_ROLLOUT_CHECKLIST.md)

The public edge backend is not considered implemented until the checklist's room coordination, media upload/range delivery, security and end-to-end smoke tests pass. Deployment must remain free-first; do not enable paid resources or provide billing details without owner approval.
