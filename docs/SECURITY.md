# Security

SonicSync is designed first for trusted local networks. Host control requires an unguessable host token. Room codes are identifiers and must not be treated as credentials.

Server-side protections include room/join/upload rate limits, bounded packet sizes, generated media paths, room locking, host-only administration, safe text normalization, CSP/security headers and tokenized media URLs.

Before public deployment, add TLS, durable identity, signed sessions, audit logs, datastore isolation, object-storage policies, secret rotation and abuse monitoring.
