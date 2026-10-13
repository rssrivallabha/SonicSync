# Troubleshooting

## Device cannot join

Check the device is on the same LAN/hotspot as the host and that the printed LAN URL is reachable.

## Stuck in PREPARING

Open diagnostics and check media download/decode, audio permission and clock sample count. Reloading does not reset the room timeline; joining reuses the current room state.

## Sync looks bad after Bluetooth/headset change

The output route changes latency. Re-run calibration or use speaker/wired output for the reference test.

## Host disappeared

Participants enter a safe state and retain their last useful position. Reclaim the room with the stored host token.
