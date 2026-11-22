# Yandex signaling on YDB — implementation plan

Status: schema draft for isolated branch `test`. Not applied to YDB and not deployed.

## Scope and protocol

This store is for the Yandex API Gateway WebSocket signaling function only. It does not replace the account database or persist player profiles. WebRTC media/game traffic remains peer-to-peer.

The current Yandex client protocol remains:
- host request: `{op:"host"}`
- guest request: `{op:"join", room, name}`
- signaling: `{op:"signal", cap, to, data}`
- server events: `sig:ready`, `peer:join`, `signal`, `peer:left`, `err`

The existing client currently expects a `Y1.` room token. Switching to the Cloudflare-compatible 8-character code requires a coordinated client change and must not be done by truncating a token. First implementation should preserve the existing `Y1.` client contract while introducing persistent room/peer state. A later client protocol migration can be done separately and tested.

## Tables

- `rooms`: one row per room; host connection, host capability hash, created/expiry timestamps, guest count, status.
- `peers`: one row per participant keyed by (room_code, peer_id); API Gateway connection ID, role, display name, capability hash and timestamps.

Only hashes of capabilities are stored. Raw capability tokens are returned to the relevant client and must never be logged or stored in YDB.

TTL is configured for one hour after `expires_at_ms` to clean stale rows eventually. TTL is asynchronous; the function must reject expired rooms/peers immediately by comparing `expires_at_ms` with current time. Disconnect handling must explicitly delete rows and update room guest_count; TTL is only a backstop.

## Required invariants

1. One host per room.
2. A guest can join only an existing, non-expired room with a connected host.
3. Guest limit: 15 (matching the archived Cloudflare test Worker).
4. Every operation validates the capability hash, room, role, expiry and target peer membership.
5. Signaling payload types are restricted to offer, answer and candidate; enforce a conservative serialized message size limit and per-connection rate limit.
6. A guest disconnect deletes that peer and notifies the host with `peer:left`.
7. A host disconnect invalidates the room, notifies guests, and deletes room membership.
8. Missing/delayed DISCONNECT events are handled by expiry checks and cleanup on join/host creation.
9. Writes that change guest_count and peer membership must be transactional or use a conditional write strategy to avoid admitting more than 15 guests under concurrent joins.
10. API Gateway connection IDs and operation-token context must come from the actual Yandex event shape, not guessed field names.

## Critical implementation constraint

The YDB schema alone does not make WebSocket fan-out reliable. The function must retain the exact Yandex API Gateway REST `:send` path and authorization behavior already proven in the current handler. Before replacing that handler, re-verify its deployed source and OpenAPI event mapping. The exported console page is not a source-code export.

## Configuration

The function environment needs:
- `YDB_ENDPOINT=grpcs://ydb.serverless.yandexcloud.net:2135`
- `YDB_DATABASE=<exact database path from the YDB overview>`
- metadata authentication enabled in the YDB SDK environment (`YDB_METADATA_CREDENTIALS=1`, if required by the selected SDK version)

Use the attached service account `zomb-signal-test` and its database-scoped `ydb.editor` grant. Never add service-account keys, IAM tokens, HMAC secrets or API keys to Git.

The YDB Node.js console example uses `ydb-sdk`, `Driver`, and `getCredentialsFromEnv()`. Confirm the SDK version and supported Node.js runtime before packaging the function. The current YDB documentation also describes the newer `@ydbjs/core` / `@ydbjs/query` SDK; do not mix APIs from the two SDK generations.

## Rollout boundary

- This is an isolated draft on branch `test`.
- Do not apply this SQL until the function code and schema have been reviewed together.
- Do not edit `main`, production Cloudflare, the existing deployed Yandex function, or the API Gateway.
- No live two-device or ICE success is claimed.
