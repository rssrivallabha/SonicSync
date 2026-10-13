# SonicSync v7 Audit — Failure Modes and Mitigations

| Risk / loophole | v5 behavior | v7 mitigation |
|---|---|---|
| High RTT causes stale scheduled position | A command arriving after its effective time could start from the old position | Absolute future target + late-command extrapolation advances position by command lateness |
| Sync command does not "stick" | Manual sync could be performed again without verification | Sync result is measured after the target and retried automatically when phase error remains >12 ms |
| Weak Wi-Fi increases clock noise | Fixed 600 ms sync horizon and strict low-RTT sample filter | Adaptive lead based on RTT + jitter; rolling 48-sample clock model with weighted median |
| Raw wall-clock offset looks like audio lag | A large clock difference was easy to misread as speaker skew | Separate clock offset, drift, jitter and actual audio error telemetry |
| Host is not the same timing source as clients | Host could behave differently from the remote nodes | Common audio timeline plus optional host output-phase bias |
| Resync causes previous source to kill the new source | Old `onended` handlers could act on a replacement source | Source generation IDs and identity checks ignore stale source callbacks |
| Pause loses position | Pause/resume state was easy to collapse into start-from-zero | Explicit paused state stores exact synchronized position |
| Stop unexpectedly restarts from zero | Stop cleared position | `STOP / HOLD` retains position; `RESET 00:00` is explicit |
| Stale seek after stop/pause | Pending seek could execute after a newer control command | Pause/stop/reset/start/resume cancel pending seeks |
| Host disconnect leaves orphan playback | Clients could keep playing without authoritative control | Host loss explicitly stops active participants and retains position |
| Track never ends cleanly | Server had no duration | Clients report duration; server auto-transitions when known |
| iOS autoplay gate | Join could initialize audio only after async network flow | Audio user gesture acquired before network work; activation tone inside gesture path |
| iOS codec/decode path fails | Web Audio decode was the only path | HTMLMediaElement fallback + range-capable media endpoint |
| Mobile media loader does not range request | Media endpoint lacked robust range semantics | 206/Content-Range/Accept-Ranges and explicit MIME types |
| PWA caches dynamic API state | Service worker could cache API responses | API/media paths explicitly bypass service worker |
| Host role races on refresh | Old host socket could prevent reclaim | Host token can reclaim role; previous host socket is closed safely |
| Room state lost on process restart | Rooms were memory-only | Atomic `data/rooms.json` persistence with expired-room filtering |
| Upload/track ordering race | Upload response and track registration could race | Track is committed before response and broadcast |
| Brute-force/noisy joins | Limited connection/room abuse controls | Per-IP connection/join/upload rate limits and room locking |
| Oversized control packets | Potential memory/CPU abuse | WebSocket payload cap + bounded telemetry fields |

## Acceptance targets

For a four-device LAN demo, the host should show:

- `AUDIO READY 4/4`
- `SPEAKER ENABLED 4/4`
- `CLOCK LOCK 4/4`
- no negative/positive clock offset value should be interpreted as audio delay
- `AUDIO ERROR` should converge after start and after manual sync
- pause -> resume should continue from the paused timestamp
- stop/hold -> resume should continue from the stopped timestamp
- reset -> play should start at 00:00
- iPhone/iPad participant can activate audio with the explicit Join/Enable gesture and play a supported MP3/AAC track
