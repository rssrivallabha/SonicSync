# Offline / No-Access-Point Connection Roadmap

A room code is an identifier; a browser cannot create a new radio/network connection from the code alone. Browser v7 therefore uses local IP/hotspot transport.

## Target product

`HOST → CREATE ROOM → 6-CHAR CODE`

`PARTICIPANT → ENTER CODE → NEARBY DISCOVERY → SECURE PAIR → TRACK TRANSFER → READY → PLAY`

## Android

Use Google Nearby Connections for offline nearby discovery and encrypted P2P transport.

## Apple

Use Wi-Fi Aware + Network framework on supported devices, with peer-to-peer Wi-Fi where appropriate.

## Sync reuse

Keep `startAt`, `effectiveAt`, clock samples, `AUDIO ERROR`, readiness barrier, master volume, and recovery commands. Replace only the browser transport/audio adapters.
