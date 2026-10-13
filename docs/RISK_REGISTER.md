# Risk Register

| ID | Risk | Severity | Current mitigation | Exit evidence |
|---|---|---:|---|---|
| R1 | Device audio clocks drift | High | NTP samples, drift estimate, phase correction | Long-run drift test + physical click measurement |
| R2 | Network jitter destabilizes playback | High | Full preload, future scheduling, adaptive lead | Loss/jitter simulation + weak-LAN run |
| R3 | Stale callbacks resurrect playback | High | revision + timelineEpoch + source generation | stale command test suite |
| R4 | iOS audio activation | High | gesture-time WebAudio/media priming | iOS Safari/Chrome physical test |
| R5 | Output route changes latency | High | telemetry, calibration invalidation | route-change matrix |
| R6 | Host failure | High | canonical room state + participant safe-stop | host-loss test |
| R7 | Malicious media/control input | High | limits, authorization, generated paths, packet validation | fuzz/security test |
| R8 | Browser cannot create radio link | High | explicit LAN boundary; native roadmap | native transport prototype |
| R9 | Acoustic claim exceeds software evidence | Critical | measurement gate in docs/UI | oscilloscope/mic evidence |
| R10 | Mobile decoded memory pressure | Medium | preload gate and large-file safety budget | memory stress on low-end device |
