# Transports

## Control / media / timing separation

SonicSync keeps room control, media distribution and timing traffic logically separate. Once a track is locally available and verified, the network path must not directly dictate the sample playback instant.

## Browser / LAN

WebSocket carries authoritative room control and telemetry. Media uses HTTP Range requests and local caching. WebRTC data channels provide a direct timing/control optimization where the browser supports it. Browser mode assumes an existing LAN/hotspot.

## Android nearby

`native/android` uses Google Nearby Connections with `P2P_CLUSTER` for local discovery and bidirectional peer messaging. Native audio scheduling is handled by Oboe; Nearby is not used as the audio sample clock.

## iOS local transport

`native/ios/SonicSyncIOS` uses Network.framework Bonjour discovery with local TCP connections. Native audio scheduling is handled by AVAudioEngine/AVAudioPlayerNode and host-time timestamps.

## Desktop

Desktop audio is platform native: WASAPI on Windows, Core Audio on macOS and PipeWire where the Linux development/runtime stack is available. Transport remains a separate concern from the audio callback.

## Fallback order

1. Native nearby/local P2P where supported.
2. Local LAN or hotspot.
3. WebRTC/direct peer transport where appropriate.
4. Browser fallback.

A room code is an identifier and authentication bootstrap value; it is not itself a physical network link.
