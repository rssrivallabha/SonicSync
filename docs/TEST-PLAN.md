# SonicSync v7 Physical Validation Plan

## 1. Cold start — four devices

Host + three phones on one hotspot/LAN. Upload a 30–90 second MP3. Confirm:

- AUDIO READY 4/4
- SPEAKER ENABLED 4/4
- CLOCK LOCK 4/4
- all nodes start from the same track position

Record MAX SYNC RANGE at 5s, 30s and 90s.

## 2. Distance / weak-LAN test

Put one phone near the host and another progressively farther away or behind a wall. Watch RTT/JITTER and AUDIO ERROR.

Press SYNC TO HOST on the affected phone multiple times. It should converge rather than repeatedly restart from an old position.

## 3. Late control packet test

Throttle/introduce LAN delay. Start/resume/sync commands should extrapolate a late packet to the current track position rather than replay the command's stale position.

## 4. Pause/resume

Let playback reach a non-zero position. Press PAUSE, wait 2 seconds, then RESUME. The track must continue from the paused timestamp.

## 5. Stop/hold/resume

Let playback reach a non-zero position. Press STOP / HOLD, verify playback stops and the UI retains the position, then RESUME. It must continue from the retained position.

## 6. Reset

Press RESET 00:00. Verify every node returns to zero, then PLAY to confirm a clean restart.

## 7. Repeated sync / source-generation test

While playing, press SYNC TO HOST three times rapidly. The old audio source must not stop or interfere with the newest source.

## 8. Host sync-all

Introduce different per-device trims. Press SYNC ALL NODES. Participants should converge toward the host reference.

## 9. iOS test

Scan the QR on an iPhone/iPad. Tap `JOIN & ACTIVATE SPEAKER`. Upload an MP3/AAC track from the host and verify audible playback. Repeat in Safari and Chrome on iOS.

## 10. Visibility/background test

Start playback, lock the phone or background the browser, return to the app, and verify that the node either resumes safely or reports a sync-needed state and re-locks to the room timeline.

## 11. Track replacement

Replace the track twice while several devices are joined. Every node must invalidate the old buffer and prepare the new track without manual ARM action.

## 12. Network disconnect/reconnect

Disconnect one participant for 10–15 seconds. Reconnect. It must rebuild its clock model, load the current track if necessary, and resynchronize to the current room position.

## 13. Host loss

Close the host during playback. Participants must stop and retain a useful playback position. Reopen the host with the stored host token and confirm room control can be reclaimed.

## 14. Security/control

Lock the room, attempt a new join, test host kick, upload-rate limits and malformed room codes.
