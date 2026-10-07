# Synchronization Measurement

## Electrical test

### Channel A
GPIO SYNC_MARKER from each node.

### Channel B
Audio electrical reference.

For the MAX98357A node, use an appropriate differential measurement method across SPK+ and SPK− or measure a safe pre-amplifier digital/analog reference. Never ground one side of a BTL speaker output.

Measure:

```
T_gpio
T_audio
ΔT = T_audio - T_gpio
```

Repeat at least 100 times for startup/retrigger measurements and record the full distribution.

## Acoustic test

Use the same physical microphone and acquisition clock for both sources where practical.

```
Node A speaker ─┐
               ├── measurement microphone(s) / interface
Node B speaker ─┘
```

Use a short broadband click or 1 kHz tone burst with an unambiguous onset.

Measure acoustic onset consistently using the same detection algorithm.

## Phone comparison

Run two experimental populations:

### Phone population
- built-in speaker
- wired output where available
- Bluetooth output as a separate class

### Hardware population
- identical SonicSync nodes
- identical firmware
- identical speaker driver and enclosure where possible

For each population record:
- startup skew
- steady-state skew
- drift over 5/15/30 minutes
- resynchronization error
- route changes
- RF conditions

Do not mix Bluetooth results with wired/built-in results.

## Hardware timestamp requirement

A physical node should expose:

```
GPIO marker
+
audio event
```

from the same local scheduling decision.

For two nodes:

```
Δ_node = (T_audio_A - T_gpio_A) - (T_audio_B - T_gpio_B)
```

For acoustic testing:

```
Δ_acoustic = T_acoustic_A - T_acoustic_B
```

The latter is the strongest direct measure of audible relative timing.

## Long-run drift

For steady playback:

```
error(t) = acoustic_arrival_A(t) - acoustic_arrival_B(t)
```

Fit a line over time.

Slope gives relative drift.

Report drift in:
- ms/minute
- ppm where justified by the fitted model

Do not infer hardware oscillator ppm from a single start measurement.

## Evidence levels

L0 — no measurement

L1 — software telemetry only

L2 — electrical GPIO/audio measurement

L3 — acoustic relative measurement

L4 — repeated acoustic measurement across routes/devices/distances

Only L3/L4 evidence should support claims about physical speaker synchronization.
