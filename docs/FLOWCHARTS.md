# SonicSync Engineering Flowcharts

These are executable decision diagrams, not decorative product diagrams.

## 1. Complete system operation

```mermaid
flowchart TD
  A[Launch] --> B{Role?}
  B -->|Host| C[Create authoritative room]
  B -->|Participant| D[Discover / enter room]
  C --> E[Authenticate peers]
  D --> E
  E --> F{Authenticated?}
  F -->|No| G[Reject + rate limit]
  F -->|Yes| H[Negotiate transport]
  H --> I[Acquire / import track]
  I --> J[Content hash + metadata]
  J --> K[Distribute / cache]
  K --> L{Media + decoder + audio + clock + output ready?}
  L -->|No| M[Retry / expose reason / remain non-playing]
  M --> L
  L -->|Yes| N[Estimate clocks]
  N --> O[Compute future playback target]
  O --> P[Schedule local audio]
  P --> Q[PLAYING]
  Q --> R{Playback error / drift acceptable?}
  R -->|Yes| S[Continue + telemetry]
  S --> R
  R -->|No, confidence good| T[Soft rate correction]
  T --> R
  R -->|No, confidence poor| U[Re-lock clocks / resync]
  U --> N
  Q --> V{Disconnect?}
  V -->|Yes| W[DEGRADED / reconnect]
  W --> N
```

## 2. Host workflow

```mermaid
flowchart TD
  A[Host launch] --> B[Create room]
  B --> C[Room ID + room code + secret]
  C --> D[Advertise discovery capability]
  D --> E[Accept join]
  E --> F[Authenticate]
  F --> G{Accepted?}
  G -->|No| H[Reject]
  G -->|Yes| I[Add participant]
  I --> J[Distribute current room state]
  J --> K{Track available?}
  K -->|No| L[Wait for source]
  K -->|Yes| M[Preload barrier]
  M --> N{All required nodes ready?}
  N -->|No| O[Show exact blocked readiness component]
  O --> M
  N -->|Yes| P[Issue future PLAY command]
  P --> Q[Monitor room health]
```

## 3. Participant workflow

```mermaid
flowchart TD
  A[Open] --> B[Discover / enter code]
  B --> C[Verify room]
  C --> D[Authenticate]
  D --> E{Accepted?}
  E -->|No| F[Reject]
  E -->|Yes| G[Receive track metadata]
  G --> H{Cached hash matches?}
  H -->|Yes| I[Local decode]
  H -->|No| J[Resumable download]
  J --> K[Verify SHA-256]
  K --> L{Hash valid?}
  L -->|No| J
  L -->|Yes| I
  I --> M[Audio engine ready]
  M --> N[Clock lock]
  N --> O[Report readiness]
  O --> P[Schedule authoritative timeline]
  P --> Q[Play]
```

## 4. Room creation / joining

```mermaid
flowchart TD
  A[Create Room] --> B[Generate random room ID]
  B --> C[Generate non-guessable room secret]
  C --> D[Generate short room code]
  D --> E[Advertise join capability]
  F[Participant Join] --> G[Resolve code]
  G --> H{Room exists?}
  H -->|No| I[Fail explicitly]
  H -->|Yes| J[Issue nonce]
  J --> K[HMAC proof]
  K --> L{Proof valid + nonce current?}
  L -->|No| I
  L -->|Yes| M[Authenticated session]
```

## 5. Device discovery

```mermaid
flowchart TD
  A[Join] --> B{Native nearby capability?}
  B -->|Yes| C[Native discovery]
  B -->|No| D{LAN available?}
  D -->|Yes| E[LAN discovery / host endpoint]
  D -->|No| F{WebRTC signaling available?}
  F -->|Yes| G[WebRTC]
  F -->|No| H[Explicit unavailable state]
  C --> I[Verify host identity]
  E --> I
  G --> I
```

## 6. Authentication / pairing

```mermaid
flowchart TD
  A[Receive HELLO] --> B[Generate single-use nonce]
  B --> C[Participant creates HMAC proof]
  C --> D[Validate message envelope]
  D --> E[Verify nonce]
  E --> F[Verify proof]
  F --> G{Valid?}
  G -->|No| H[Reject + record security event]
  G -->|Yes| I[Create authenticated session]
```

## 7. Audio acquisition

```mermaid
flowchart TD
  A[Select source] --> B{Source type}
  B -->|File| C[FileSource]
  B -->|System mix| D[Native system capture]
  B -->|Application| E[Native app capture]
  B -->|Microphone| F[Input capture]
  B -->|Live| G[Live stream]
  C --> H{Capture permitted?}
  D --> H
  E --> H
  F --> H
  G --> H
  H -->|No| I[Explain OS / DRM limitation]
  H -->|Yes| J[Normalize]
```

## 8. Audio distribution

```mermaid
flowchart TD
  A[Track metadata] --> B{Local cache hash hit?}
  B -->|Yes| C[Reuse]
  B -->|No| D[Chunked transfer]
  D --> E{Network interruption?}
  E -->|Yes| F[Persist completed chunks]
  F --> D
  E -->|No| G[Complete]
  G --> H[SHA-256 verify]
  H --> I{Valid?}
  I -->|No| D
  I -->|Yes| J[Decode]
```

## 9. Buffer / decode

```mermaid
flowchart TD
  A[Track bytes] --> B[Decoder]
  B --> C{Decode succeeds?}
  C -->|No| D[Report codec failure]
  C -->|Yes| E[Audio buffer]
  E --> F{Buffer policy satisfied?}
  F -->|No| G[Continue preload]
  F -->|Yes| H[AUDIO_ENGINE_READY]
```

## 10. Clock synchronization

```mermaid
flowchart TD
  A[Probe] --> B[t1]
  B --> C[Remote receives]
  C --> D[t2]
  D --> E[Remote replies]
  E --> F[t3]
  F --> G[Local receives]
  G --> H[t4]
  H --> I[Compute offset + RTT]
  I --> J[Minimum RTT filtering]
  J --> K[Median / robust estimate]
  K --> L[Drift regression]
  L --> M[Confidence + uncertainty]
  M --> N{Confidence adequate?}
  N -->|No| O[Remain unlocked]
  N -->|Yes| P[CLOCK_READY]
```

## 11. Playback synchronization

```mermaid
flowchart TD
  A[Authoritative position] --> B[Compute adaptive lead]
  B --> C[Create target T]
  C --> D[Broadcast PLAY AT T]
  D --> E[Convert remote T to local domain]
  E --> F[Native / Web Audio scheduler]
  F --> G{Plan stale?}
  G -->|Yes| H[Discard]
  G -->|No| I[Start at target]
  I --> J[Observe phase]
  J --> K{Small error + good confidence?}
  K -->|Yes| L[Bounded rate correction]
  K -->|No| M{Large error?}
  M -->|No| J
  M -->|Yes| N[Future re-anchor]
```

## 12. Pause / resume / seek

```mermaid
flowchart TD
  A[PLAYING] --> B{Command}
  B -->|PAUSE| C[Evaluate authoritative position]
  B -->|STOP| D[Evaluate authoritative position]
  B -->|SEEK| E[New position]
  C --> F[Cancel future sources + increment epoch]
  D --> F
  E --> F
  F --> G[Publish new revision]
  G --> H[Future effective time]
  H --> I[Nodes schedule]
  I --> J{Resume?}
  J -->|Yes| K[Continue retained / seek position]
  J -->|No| L[Remain PAUSED / STOPPED]
```

## 13. Late join

```mermaid
flowchart TD
  A[Join while playing] --> B[Authenticate]
  B --> C[Receive authoritative track/timeline]
  C --> D[Preload + decode]
  D --> E[Clock lock]
  E --> F[Evaluate current authoritative position]
  F --> G[Compute future join target]
  G --> H[Schedule from current timeline position]
  H --> I[Join without restarting existing nodes]
```

## 14. Reconnect / failure recovery

```mermaid
flowchart TD
  A[Connection lost] --> B[Stop trusting transport quality]
  B --> C[Enter DEGRADED]
  C --> D{Audio can safely continue locally?}
  D -->|Yes| E[Continue cached playback]
  D -->|No| F[Pause locally]
  E --> G[Reconnect]
  F --> G
  G --> H{Authenticated + session valid?}
  H -->|No| I[Rejoin]
  H -->|Yes| J[Clock re-lock]
  I --> J
  J --> K[Calculate timeline position]
  K --> L[Future soft resync]
```

## 15. Hardware speaker-node operation

```mermaid
flowchart TD
  A[Boot] --> B[Initialize Wi-Fi]
  B --> C[Initialize I2S]
  C --> D[Initialize local ring]
  D --> E[Ready]
  E --> F[Receive packet]
  F --> G{Valid header?}
  G -->|No| H[Drop + increment counter]
  G -->|Yes| I{Command or PCM?}
  I -->|Command| J[Update scheduled state]
  I -->|PCM| K[Push ring buffer]
  J --> L[Audio task]
  K --> L
  L --> M{Scheduled target reached?}
  M -->|No| N[Output safe silence / prior scheduled state]
  M -->|Yes| O[I2S output]
  O --> P[GPIO measurement marker]
  P --> Q[Speaker]
```

## 16. Calibration / latency measurement

```mermaid
flowchart TD
  A[Calibration] --> B[Schedule marker + test tone]
  B --> C[Capture GPIO]
  C --> D[Capture electrical audio]
  D --> E[Capture acoustic arrival]
  E --> F[Store raw waveform/timestamps]
  F --> G[Compute domains]
  G --> H[Persist calibration offset]
  H --> I{Output route changed?}
  I -->|Yes| J[Invalidate calibration]
  J --> B
  I -->|No| K[Use calibration]
```
