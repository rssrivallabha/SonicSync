# Cloudflare public mode

This is a separate public deployment target. It does not replace the local Node.js server. The Wrangler assets config uses `run_worker_first: true` so WebSocket upgrades and `/api/*` routes reach the Worker before the static asset fallback.

## Before deploying

1. Have Node.js 22+ installed.
2. Run `npm install` at the repository root.
3. Run `npm run validate` and `npm run public:check`. The public check includes a Wrangler bundle/config dry-run.
4. Run `npm run public:dev` and test room creation/join, upload an MP3/WAV under 25 MiB, media Range fetch, playback controls, pause/resume, and two devices.
5. Only after local Worker tests pass, deploy with `npm run public:deploy`.

## No-card rule

Use Workers Free only if the account dashboard lets the Worker and SQLite-backed Durable Object binding be created without a card. If Cloudflare requests card verification or paid activation, stop and do not submit payment details. This repository does not automatically provision paid services.

## Free-tier restrictions

- Room creation: five per client IP per hour; two active public rooms globally; six devices per room; room/media TTL: four hours. The host can end a room to disconnect devices, delete its uploaded chunks, and release its active-room slot.
- Track size: 25 MiB maximum; public uploader accepts MP3 and WAV.
- Upload chunk size: 1 MiB, below the documented 2 MiB SQLite row/BLOB limit.
- Public clients refresh the server clock every 3 seconds after an initial sample burst and publish telemetry every 10 seconds; local/offline mode keeps the faster cadence.
- The published Workers Free limits include 100,000 Worker requests/day; SQLite Durable Objects include 100,000 rows written/day and 5 GB aggregate storage. These are account-wide hard limits, not a capacity guarantee. The two-room/six-device cap deliberately leaves room for free-tier headroom, but public use can still hit quotas.
- Official limits: https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/durable-objects/platform/pricing/. The app must remain on a no-cost setup; if an account demands billing activation or payment details, stop and ask the owner.
- Media is stored as SQLite chunks to avoid requiring an R2 subscription in this prototype. That is not an unlimited storage strategy.

## Current status

This is an early public-mode implementation slice. It still needs runtime tests under Wrangler, frontend integration tests, cross-browser tests and multi-device tests before being considered deployable. Sync numbers are software telemetry until validated with physical measurements.
