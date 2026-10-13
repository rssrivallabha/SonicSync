# SonicSync v10 Release Readiness

## What is currently verified

The browser/shared-core path passes the repository's static and unit validation. Native platform source is implemented and source-checked, but platform-device builds are still gates. The ESP32-S3 hardware path is source-implemented and physically unverified.

## Mandatory release gates

1. Web dependencies install successfully and `npm run smoke` passes on a network-enabled machine.
2. Android builds and runs on physical hardware with Nearby Connections + Oboe output.
3. iOS builds and runs on physical hardware with Network.framework + AVAudioEngine and survives interruption/route/lock tests.
4. Windows/macOS/Linux native output paths build on their target OSes and report actual output latency.
5. ESP32-S3 firmware flashes and executes on the physical node.
6. Physical synchronized click tests at 1/2/5/10/20/30/40/50 m are captured under documented environments.
7. Reported acoustic skew includes measurement uncertainty and P50/P95/P99/max distributions.

## Do not claim

- 1 ms or sub-ms acoustic synchronization without physical evidence.
- universal 50 m operation; radio environment, walls, antenna orientation and hardware vary.
- OS-level speaker-volume control when only SonicSync gain is changed.
- unrestricted capture of DRM/protected or otherwise platform-restricted system audio.
