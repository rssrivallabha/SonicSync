# SonicSync Hardware Architecture v10

## Reference node

```text
            2.4 GHz Wi-Fi
                 │
                 ▼
      ┌────────────────────┐
      │ ESP32-S3-WROOM-1  │
      │  8 MB PSRAM class │
      │ monotonic timer   │
      │ Wi-Fi / BLE       │
      └─────────┬──────────┘
                │ I2S
        48 kHz / 16-bit
                ▼
      ┌────────────────────┐
      │ MAX98357A / DAC     │
      │ Class-D I2S amp   │
      └─────────┬──────────┘
                ▼
          4 Ω / 8 Ω driver
                ▼
             enclosure

GPIO4 = I2S BCLK; GPIO5 = I2S WS/LRCLK; GPIO6 = I2S DOUT; GPIO7 = timing marker for the measurement fixture.
```

## Design boundary

The ESP32-S3 reference node is the deterministic timing prototype. It intentionally uses locally available PCM/WAV test material rather than pretending that compressed-audio decoding on the MCU is already production-complete. The Raspberry Pi reference path is the full-format/SoC option for a later production candidate.

## Timing contract

The host sends a future `startAt` timestamp in host monotonic microseconds plus the measured `clockOffsetUs` (host clock minus node clock). The node converts the deadline into its own `esp_timer_get_time()` domain before scheduling. Network arrival time therefore does not become the playback timestamp.
