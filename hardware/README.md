# SonicSync Hardware Track

`esp32s3-speaker-node/` is the MCU timing reference. `measurement/gpio-timestamp-fixture/` is the external timing logger. `BOM.md`, `SCHEMATIC.md`, `HARDWARE_LATENCY.md`, and `SYNCHRONIZATION_MEASUREMENT.md` define what is measured and what is not claimed.

The hardware track intentionally separates:

- **clock offset/drift/uncertainty** — network time model;
- **playback phase error** — software timeline error;
- **output latency** — output driver/DAC path;
- **acoustic error** — actual transducer/microphone timing;
- **node-to-node skew** — final relative acoustic alignment.

A physical run is required before any sub-ms or 50 m performance statement.
