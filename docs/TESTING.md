# Testing

## Automated

`npm run validate` runs static checks, dependency-free core tests and preflight.

`npm run sim` runs deterministic sync simulations. Use larger node counts and harsher network parameters for regression.

`npm run smoke` is the end-to-end LAN/HTTP/WebSocket smoke path and requires installed runtime dependencies.

## Required physical tests

Create/join, READY barrier, scheduled start, pause/resume, stop/hold, reset, seek, late join, reconnect, host loss, route changes, Bluetooth, background/foreground, Android permissions, iOS activation and the full 1–50 m distance matrix.

CI must report failures; test weakening is not an acceptable route to green builds.
