# Deployment

## Browser/LAN pilot

```bash
npm install
npm run validate
npm run smoke
npm start
```

Open the LAN URL printed by the server from devices on the same trusted network.

## Native builds

See `docs/NATIVE-BUILD.md`. Android requires Android Studio/SDK/NDK and a device or emulator; iOS requires Xcode and a local iOS device/simulator; desktop requires CMake plus the native platform audio development stack.

## Hardware

See `hardware/README.md` and `hardware/esp32s3-speaker-node/README.md`. The hardware node is a physical lab target, not a claim that the current repository has completed acoustic validation.

## Production boundary

Do not expose the browser pilot directly to the public Internet. A production deployment still needs TLS termination, durable session/media storage, authenticated identities, rate limiting, observability, secure secrets handling and platform-specific distribution/signing.

## Evidence rule

Simulation, desktop source compilation and unit tests prove software properties only. Output latency, acoustic calibration error and node-to-node skew require physical measurement.
