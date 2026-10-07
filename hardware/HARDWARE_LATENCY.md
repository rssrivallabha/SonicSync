# Hardware Latency Model

The node exposes a measurable chain:

```
command received
    ↓
command accepted
    ↓
local scheduler target
    ↓
audio buffer prepared
    ↓
I²S sample stream
    ↓
DAC / digital Class-D
    ↓
speaker diaphragm
    ↓
acoustic arrival
```

For the MVP MAX98357A path, the DAC and Class-D stages are integrated into one device. Do not invent a separate DAC latency number.

## Required measurements

Record for every run:

- command receive timestamp
- GPIO marker timestamp
- first measurable audio electrical transition
- first acoustic arrival
- sample rate
- I²S frame format
- audio buffer size
- radio transport
- supply voltage
- speaker
- temperature
- node firmware revision

Report:

- command → GPIO
- GPIO → electrical audio
- command → electrical audio
- electrical audio → acoustic
- command → acoustic
- node-to-node acoustic difference
- run-to-run standard deviation
- P50/P95/P99/max

## Important distinction

A stable 5 ms output pipeline is not the same as 5 ms synchronization.

For synchronization:

```
relative_error = acoustic_arrival_A - acoustic_arrival_B
```

The absolute command-to-acoustic delay can be large and still be useful when it is stable and calibrated.

The objective is a small **relative** skew and low variation.

## No unmeasured claims

Until a scope/logic analyzer/audio-interface measurement is recorded, fields such as measuredOutputLatency and acousticCalibrationOffset remain unknown.

A platform-reported output latency may be stored as an estimate but cannot replace physical measurement.
