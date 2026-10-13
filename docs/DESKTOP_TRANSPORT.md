# Desktop Local Transport

SonicSync desktop now has a dependency-free LAN control transport in `native/desktop/src/local_transport.cpp`.

## Discovery

- UDP IPv4 multicast: `239.255.42.99:42421`
- Beacon: `SONICSYNC/10|<room>|<tcp-port>`
- Discovery carries only room identity and a TCP endpoint.
- A matched room causes the participant to open a TCP connection automatically.

## Control channel

- TCP, newline-delimited JSON frames.
- Maximum frame size: 128 KiB.
- Partial reads and message framing are handled incrementally.
- Send failures remove the affected peer instead of reporting a false connected state.
- Socket shutdown is used before close so worker threads can exit deterministically.

## Security boundary

This transport is a local discovery/transport primitive, not a cryptographic session protocol. It must be paired with the authenticated SonicSync protocol/session key before production deployment on an untrusted LAN. The transport deliberately does not expose a false security claim.

## Verification

A two-process Linux smoke harness was compiled against the transport implementation. The client discovered the host and delivered `PING`; the host received `RX=PING` successfully.
