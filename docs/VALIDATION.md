# SonicSync v7 Validation Status

## Automated source validation

- Node syntax validation for `server.js`, `public/app.js`, and the smoke-test script
- HTML id -> JavaScript selector consistency
- `.hidden` visibility CSS presence
- version consistency
- upload commit ordering
- late command extrapolation
- adaptive synchronization lead
- weighted clock filter + jitter path
- manual sync retry protocol
- stale `AudioBufferSourceNode.onended` generation guard
- pause/stop position persistence
- explicit reset path
- iOS activation and media fallback path
- HTTP Range media serving
- host output phase bias
- command revision guard
- service-worker dynamic-route exclusion
- legacy upload-track WebSocket path removal

Run:

```bash
npm run check
```

## Protocol smoke test

After dependencies are installed:

```bash
npm run smoke
```

The smoke test starts a real local server and exercises the HTTP/WebSocket room protocol, including upload, readiness, start, pause/resume position retention, stop/hold, reset, volume propagation and byte ranges.

## Not falsely claimed

Physical acoustic validation across iOS/Android devices cannot be performed in this packaging environment. npm registry access also timed out during dependency installation here, so no fake end-to-end phone result is claimed.
