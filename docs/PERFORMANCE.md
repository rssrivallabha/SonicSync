# SonicSync Performance & Measurement Contract

This repository separates **software timing error** from **physical acoustic skew**.

## Software metrics

`Emax = max(node position) - min(node position)` is evaluated from each node's reported local playhead. Record P50/P90/P95/P99/max over a run. Also record clock offset, drift, jitter, uncertainty, RTT, packet loss, output latency and correction rate.

## Simulation

Run:

```bash
npm run sim
npm run sim -- --nodes 32 --duration 120 --latency 80 --jitter 25 --drift 120 --loss 0.03
```

Simulation results are not proof of acoustic synchronization.

## Physical evidence required

For hardware/acoustic claims, timestamp the same test click at the audio output or microphone of each node. Report measurement instrument, sample rate, environment, distance, wall/LOS condition, route (speaker/Bluetooth/USB/etc.), uncertainty and calibration state.

Never convert clock-offset numbers directly into acoustic latency claims.
