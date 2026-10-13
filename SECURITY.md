# SonicSync Security

Use only on a trusted private LAN/hotspot. Room authorization uses a secret host token stored locally. Uploaded media is stored under the server data directory and served only through opaque room/token paths. Upload, WebSocket, join and room creation operations are rate limited. Control payloads have bounded sizes. Rooms and media expire.

For Internet exposure, place SonicSync behind TLS, authentication, a reverse proxy and an explicit user/room authorization layer. The current browser pilot is intentionally local-first.
