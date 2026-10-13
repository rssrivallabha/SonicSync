# Render Deployment

## Important architecture note

SonicSync's main mode is local-LAN playback. This server currently keeps active WebSocket rooms in one process and stores media and room snapshots on local disk. A hosted deployment is suitable for demos and remote access tests, but not yet a durable multi-instance production deployment.

## Deploy

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint** and select this repository.
3. Review `render.yaml`.
4. Set `PUBLIC_BASE_URL` to the service's public HTTPS URL (for example, `https://sonicsync.example.onrender.com`).
5. For persistence, attach a persistent disk mounted at `/var/data` and use a paid instance plan. The free instance plan does not provide the persistence needed for durable rooms/media.
6. Deploy, then verify `/api/health` and test two devices.

## Health

`GET /api/health` returns the server version, deployment mode, storage durability mode, current room count, and local discovery status.

## Why not Vercel for this server as-is?

The app uses a long-lived HTTP/WebSocket server, in-memory room membership, file uploads, and disk-backed room/media storage. Serverless instances do not provide a shared writable filesystem or shared process memory. Changing the data path to `/tmp` only avoids the startup crash; it does not provide durable media or cross-instance room synchronization. Use a persistent Node host for the existing architecture, or implement shared room state/media infrastructure before moving to a multi-instance/serverless architecture.
