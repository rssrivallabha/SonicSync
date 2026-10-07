# SonicSync Architecture Plan

## Current implementation topology

### Control plane
- room identity and authority
- versioned protocol
- command sequencing
- authorization
- replay protection
- rate limiting
- room registry

### Media plane
- track metadata
- SHA-256 content identity
- resumable chunks
- local chunk store
- decoder boundary

### Timing plane
- clock probes
- robust clock estimation
- clock model
- future sync target
- playback phase error
- bounded rate correction
- scheduler stale-plan rejection
- deterministic convergence simulation

### Hardware/audio plane
- Android Oboe audio output
- Web Audio fallback
- ESP32-S3 I²S firmware
- MAX98357A prototype output
- GPIO measurement marker
- hardware timing capture model

## Interfaces

```
Host / participant UI
        │
        ▼
Room / command service
        │
        ├──────────────► protocol codec / validation
        │
        ├──────────────► transport abstraction
        │
        └──────────────► sync core
                                │
                                ├── clock model
                                ├── timeline
                                ├── scheduler
                                ├── phase controller
                                └── metrics
                                         │
                                         ▼
                                  audio-platform API
                                         │
                          ┌──────────────┼───────────────┐
                          ▼              ▼               ▼
                      Web Audio       Android        Hardware node
```

## Native vs browser boundary

Browser mode owns:
- UI
- Web Audio output
- WebRTC/browser-capable fallback transport

Native modes own:
- platform audio session
- low-latency audio APIs
- OS interruption/route handling
- platform nearby transport
- device-specific calibration

No UI layer implements clock mathematics.

## Network boundary

Transport implementations must present:
- connect
- close
- send
- receive
- measured quality

The synchronization layer consumes transport-independent timing samples and never inspects socket implementation details.

## Local/offline mode

The host remains the room authority on the LAN/native party network. Internet access is not required for the playback timeline itself.

## Hardware boundary

The dedicated speaker node is intentionally not coupled to the final UI protocol yet. Its firmware can be driven by the bench packet format while the authenticated production protocol remains the authoritative software protocol.

This separation is temporary and is required until the physical measurement loop is proven.

## Current architecture decision still open

A final cross-platform implementation of the sync core is not frozen between:
- TypeScript reference + platform ports
- a native shared C++ core
- a Rust/WASM/native shared core

This remains intentionally open because selecting the wrong mechanism would create duplicated authoritative implementations across web/mobile/desktop.

Until that decision is frozen, the TypeScript core is the executable reference model and native audio implementations consume equivalent timing contracts, not independent synchronization algorithms.
