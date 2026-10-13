# SonicSync Security Model

The browser pilot is a local-network product. Room codes are discovery identifiers, not authentication credentials. Host authority is established with a high-entropy host token that is never exposed to participants.

Control inputs are size-limited, type-validated and rate-limited. File paths are generated from SHA-256 content addresses and sanitized media extensions. Media is served only through a room-scoped tokenized route.

Critical release hardening still required before public Internet exposure: TLS, persistent authentication/identity, durable datastore, structured audit logging, abuse monitoring, secret rotation, signed builds and production object storage.
