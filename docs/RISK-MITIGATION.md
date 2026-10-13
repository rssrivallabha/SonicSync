# SonicSync v7 Risk → Mitigation Matrix

| Risk | Failure mode | v7 mitigation | Validation |
|---|---|---|---|
| LAN path degrades with distance | WebSocket control gets stale | Track is preloaded locally; WebRTC direct P2P sync; 120 ms host playhead beacons; adaptive lead; fallback to WS | 5/15/30 m and weak-signal test |
| Repeated SYNC does not stick | Late command / stale source wins | Direct host clock, future target, late extrapolation, source generation guard, post-sync verification + up to 3 retries | Repeated sync under degraded link |
| Pause/resume restarts track | Resume state loses canonical position | Server keeps canonical position; STOP/HOLD and PAUSE preserve it; RESET is the only zeroing command; stale resync commands canceled | 5 pause/resume + 5 stop/resume cycles |
| iOS joins but produces no sound | WebKit autoplay/audio session gate | User gesture unlock before networking; WebKit-prefixed AudioContext; audio session playback mode; MediaSession; WebAudio + inline HTML media fallback; visible diagnostic state | iOS Safari + iOS Chrome join/play |
| Direct sync peer unavailable | RTC fails on a device/network | Automatic WS fallback, reconnect and peer re-negotiation | Disable RTC / reconnect |
| Double resync | Direct + WS commands both apply | Server excludes RTC peers from syncAll fallback | Mixed RTC/WS room test |
| Service worker serves stale track/state | Old cached API/media | SW bypasses `/api` and `/media`, versioned shell assets | New-version rollout test |
| Room/host abuse | Brute force/unauthorized host | Room rate limits, host token, lock/kick, private-LAN model | Fuzz/rate test |
| Large decoded PCM kills mobile | Memory pressure | Device-aware decoded-memory cap + preload retries | Large track test |
| Host leaves mid-playback | Orphans continue | Server freezes canonical position and stops clients safely | Host disconnect test |
