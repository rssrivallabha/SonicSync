# SonicSync Physical Test Fixture

## Goal

Make every claimed timing number traceable to a physical event pair.

### Fixtures

1. SonicSync speaker node: GPIO7 timing marker + audio output.
2. Timestamp fixture: external input captures GPIO7 and produces a timestamped serial record.
3. Oscilloscope: CH1 = GPIO marker, CH2 = acoustic/line-level click. Measure Δt.
4. Optional second node: repeat the same click on CH3/CH4 or a second scope channel.

### Test sequence

```text
Host chooses T
  │
  ├─ clock probe × N → offset / RTT / uncertainty
  │
  ├─ READY barrier
  │
  └─ startAt(T, offset) ──► node
                             │
                             ├─ GPIO7 marker at output-buffer ingress
                             └─ speaker click

Scope measures:
GPIO→audio output latency
node A audio→node B audio skew
```

### Record fields

`timestamp, nodeId, distanceM, topology, wallCondition, route, sampleRate, bufferFrames, clockOffsetUs, clockDriftPpm, clockUncertaintyUs, playbackPhaseErrorUs, outputLatencyUs, acousticErrorUs, nodeSkewUs, jitterUs, powerW, temperatureC`.

### Acceptance

No sub-ms result is accepted until the GPIO-to-audio chain and the scope/microphone measurement uncertainty are documented. Report P50/P90/P95/P99/max, plus confidence/uncertainty.
