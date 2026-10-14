# Public Mode Architecture

## Decision

Add a Cloudflare Workers + SQLite-backed Durable Objects deployment for public rooms, while retaining the existing Node.js server as the nearby/offline deployment. Do not convert the local server into a serverless shim and do not remove its mDNS/local-IP behavior.

Cloudflare is a candidate for a free-first prototype because its published Workers free plan currently includes 100,000 requests/day, and SQLite-backed Durable Objects have free-tier limits. This is a quota-bound prototype, not an unlimited or guaranteed-free production promise. Check official limits before deploying:
- Workers pricing and limits: https://developers.cloudflare.com/workers/platform/pricing/
- Durable Object pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Durable Object limits, including the 2 MB maximum SQL row/BLOB size and 5 GB free aggregate storage: https://developers.cloudflare.com/durable-objects/platform/limits/

No R2 bucket is required for the first increment. Cloudflare documents a free R2 allowance, but its setup involves adding an R2 subscription; this project must not require that step or ask the owner for billing details without consent.

## Deployment targets

### Local / nearby
- Entry point: server.js
- Storage: DATA_DIR or ./data
- Active state: single-process room map
- Transport: HTTP + WebSocket, WebRTC direct peer timing/control where available, LAN/hotspot media delivery
- Works without public internet

### Public beta
- Static assets: existing public/ directory
- Edge router: cloudflare/worker.js
- Room coordinator: one SQLite-backed Durable Object per room
- Room persistence: authoritative room JSON and media metadata in the room object's SQLite database
- Media store: fixed-size BLOB chunks below the platform's 2 MB row limit; authenticated upload begin/chunk/complete APIs; SHA-256 verification before track commit
- Playback: range-capable media route; each client fetches and decodes locally, then follows the shared timeline
- WebSocket: room-specific route such as /ws?room=ABC123; the edge worker sends the connection to that room's Durable Object
- WebRTC: existing peer negotiation remains a direct path; WebSocket relay is for signaling/fallback
- Expiry: per-room TTL and deletion of expired media chunks

## Public control-plane invariants

- A room code locates a room; it does not grant host privileges.
- Host operations require a random host token, checked server-side.
- Client-supplied revisions, device telemetry, MIME types, filenames, hashes, byte counts and room codes are untrusted.
- All command payloads are schema-validated and bounded.
- Limit rooms/devices (two active rooms globally and six simultaneous devices per room), upload size, chunks, upload frequency, active room duration, and retained media.
- Content-Length, chunk index, expected chunk size and total byte count are validated.
- A track remains unplayable until every expected chunk is present and the computed SHA-256 matches.
- A stale command or timeline epoch cannot alter current playback.
- Do not store the host token in logs. Return Cache-Control: no-store on room creation, upload, and control responses.
- Error responses tell the user what happened and what action is available.

## Media budget for the first public beta

Use a conservative public cap (initially 40 MiB per track; revisit only after measuring) and a chunk payload around 1.5 MB. This remains under the platform's 2 MB SQLite row/BLOB limit and avoids relying on a single huge HTTP upload body. The browser upload path will:
1. Validate file type/size locally for quick feedback (server still validates).
2. Compute SHA-256 using Web Crypto.
3. Create an authenticated upload session.
4. Upload sequential chunks with bounded retries and progress.
5. Ask the room object to verify exact chunk count/size and the final digest.
6. Commit the track and broadcast a track offer to connected participants.
7. Remove incomplete uploads after a short timeout; expire committed media with the room.

Because the free Durable Object storage allowance is finite (5 GB aggregate, per current documentation), do not present this model as unlimited storage. Provide explicit quota errors, short retention, and admin-visible storage metrics. If public adoption outgrows this, propose object storage; ask the project owner before enabling any billing-backed subscription.

## Readiness and sync

Maintain distinct fields:
- mediaReady: media downloaded and decoded
- audioEnabled: local OS/browser output gate unlocked
- clockLocked: clock estimator reached acceptance criteria
- syncConfidence and clockUncertaintyMs
- playbackPhaseErrorMs and rateCorrectionPpm
- outputLatencyMs, acousticCalibrationOffsetMs, and measured nodeToNodeSkewMs when a physical measurement exists

Start requires all connected nodes to satisfy media and clock readiness. An audio gate is device-local; a node that has not activated audio may catch up later only according to a tested policy. Never mark a participant acoustically synchronized from clock lock alone.

## Incremental integration strategy

1. Fix and test all public base URL paths (API config, room response, QR code).
2. Add the standalone Worker/router and one SQLite Durable Object per room. The local Node path remains untouched except for shared safe helpers and tests.
3. Add durable room creation/join, host authorization, room snapshots, control messages and WebSocket relay.
4. Add bounded chunked media storage and range-serving, including digest verification and TTL cleanup.
5. Integrate the web client with the public upload protocol without regressing its local multipart upload path.
6. Add Cloudflare integration tests and a smoke test for room creation, two participants, uploaded track, future start, pause/resume and cleanup.
7. Deploy to a free account only if the dashboard allows it without payment details. If account verification demands a card, stop; use the local server plus a temporary Quick Tunnel for demos until a no-card public deployment is chosen.

## Important scale constraint

One Durable Object per room serializes room coordination and is a useful correctness boundary. Media chunks live in that room's storage in the first increment, so each room has finite quota behavior and the account storage cap is still finite. At higher traffic, evaluate moving media to a separate object store and introducing admission control. Do not add paid products or billing-backed resources automatically.
