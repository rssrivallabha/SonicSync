# Hardware Latency Budget

Treat each component separately. Do not collapse everything into “latency”.

| Stage | Metric | Instrument |
|---|---|---|
| network → receive | packet arrival delta | host/node monotonic timestamps |
| receive → decode | decode start/end | firmware/application trace |
| decode → buffer | queued-frame delta | audio scheduler counters |
| buffer → DAC | driver/output latency | GPIO marker + electrical audio tap |
| DAC → speaker | transducer propagation | microphone / acoustic tap |
| node-to-node | acoustic skew | synchronized microphone/scope |
| clock | offset/drift/uncertainty | NTP-style probes + long-run fit |

The reported **playback phase error** is the timeline error before acoustic propagation. **Acoustic error** includes actual output-chain differences. **Node-to-node skew** is the final relative timing error that matters to a listener.
