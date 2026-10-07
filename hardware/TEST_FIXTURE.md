# SonicSync Hardware Test Fixture

## Purpose

The fixture must make the physical timing claim falsifiable.

## Fixture layout

```
                 ┌────────────────────┐
                 │  OSCILLOSCOPE /    │
                 │  AUDIO INTERFACE   │
                 └───────┬────────────┘
                         │
             ┌───────────┴───────────┐
             │                       │
       GPIO marker             audio/reference
             │                       │
        Node under test          speaker
             │
             └────── acoustic field ──────┐
                                          │
                                   measurement mic
```

## Electrical fixture

For each hardware node:
1. bring GPIO SYNC_MARKER to a test point
2. bring an electrically safe audio reference to a second test point
3. trigger on the GPIO edge
4. measure the first audio transition
5. capture raw waveforms

Do not rely on application logs for this measurement.

## Acoustic fixture

For node-to-node comparison:
1. mount speakers at fixed coordinates
2. keep orientation constant
3. keep microphone position constant
4. use the same test signal
5. run repeated scheduled events
6. capture both acoustic events in the same measurement acquisition system
7. determine onset using one repeatable algorithm

For a fair phone comparison, repeat the same fixture with phone speakers at the same approximate locations.

## Repeatability

Every run records:
- fixture ID
- speaker position
- microphone position
- room
- temperature
- supply voltage
- firmware/build
- sample rate
- transport
- node IDs

## Distance campaign

Required physical points:

1 m
2 m
5 m
10 m
20 m
30 m
40 m
50 m

At 20 m+ record line-of-sight and obstruction conditions.

## Report

Generate:
- raw capture files
- CSV timestamps
- summary CSV
- P50/P95/P99/max skew
- drift plot
- recovery time
- network quality

Never overwrite raw captures with processed data.

## Equipment boundary

Physical measurement is a human/hardware dependency. Software can generate the fixture configuration, test signals, logging format and analysis utilities, but cannot honestly substitute for the oscilloscope/microphone measurement.
