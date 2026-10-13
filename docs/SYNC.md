# Synchronization Engine

SonicSync synchronizes a shared timeline, not wall-clock timestamps.

## Clock model

Each node samples `t1/t2/t3/t4`, derives RTT and offset, selects minimum-RTT samples, rejects outliers with median/MAD logic, and estimates clock-rate drift with a robust regression. The model exposes offset, drift (ppm), jitter, uncertainty and confidence.

## Timeline

`position(t) = anchorPosition + (t - anchorTime) × rate`

Commands target a future `effectiveAt`. A late command is extrapolated instead of replaying a stale position.

## Correction

Small phase errors use bounded playback-rate steering. Large errors use a future scheduled re-lock. The correction is deadbanded and bounded to prevent oscillation and integral windup.

## Metrics

Primary software metric: `Emax = max(node position) - min(node position)`.

Report P50/P90/P95/P99/max over a test interval and keep physical acoustic skew as a separate metric.
