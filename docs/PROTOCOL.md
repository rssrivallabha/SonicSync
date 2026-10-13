# SonicSync v10 Control Protocol

All server-emitted control messages are wrapped with:

- `protocolVersion`
- `messageId`
- `type`
- `timestamp`
- optional `revision`
- optional `timelineEpoch`
- message-specific fields

Client input is size-limited and type-validated. Older packets without `protocolVersion` remain accepted for local compatibility; newer incompatible versions are rejected.

## Membership

`join(room, role, name, hostToken?)`

## Clock

`sync(t1)` → `syncReply(seq, t1, t2, t3)`; the node records `t4` locally.

## Media/readiness

`trackOffer(track)` → local fetch/hash/decode → `ready(...)`.

## Playback

`start`, `resume`, `pause`, `stop`, `reset`, `seek` are authoritative room commands. Scheduled commands carry a future `effectiveAt`; late delivery is extrapolated by the node.

## Sync

`requestSync`, `syncNow`, `syncAllDispatch`, `syncApplied`, and `syncMismatch` carry future targets and revisions/epochs. Direct RTC timing is an optimization; server state remains authoritative.

## Queue

`next`, `previous`, and `queue(repeatMode, shuffle)` manipulate host-owned queue state. Queue changes emit an updated snapshot and track offers cause automatic participant preparation.

## Diagnostics

Host-only diagnostics are exportable as JSON or CSV through the room diagnostics endpoint. Host credentials are supplied via a header, not a URL query parameter.
