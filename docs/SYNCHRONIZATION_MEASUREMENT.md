# Synchronization Measurement Protocol

## Software

Collect at least 64 clock samples before a run, use minimum-RTT filtering, median/MAD rejection, and report:

- clock offset
- clock drift (ppm)
- clock uncertainty
- playback phase error
- output latency
- sync confidence

## Physical

Run scheduled click bursts at 1, 2, 5, 10, 20, 30, 40 and 50 m in line-of-sight and wall/crowded-radio conditions where the site permits. For each distance/run, collect ≥30 independent bursts. Record microphone position and route.

## Result format

```json
{
  "distance_m": 10,
  "environment": "LOS",
  "sample_rate_hz": 48000,
  "clock_offset_us": 0,
  "clock_drift_ppm": 0,
  "clock_uncertainty_us": 0,
  "playback_phase_error_us": {"p50": 0, "p95": 0, "p99": 0, "max": 0},
  "output_latency_us": {"p50": 0, "p95": 0},
  "acoustic_error_us": {"p50": 0, "p95": 0},
  "node_to_node_skew_us": {"p50": 0, "p95": 0, "max": 0},
  "measurement_uncertainty_us": 0
}
```

Zeros above are schema placeholders only. A real run must replace them with measured values.
