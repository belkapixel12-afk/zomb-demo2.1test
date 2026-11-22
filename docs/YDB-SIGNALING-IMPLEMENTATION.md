# Yandex signaling on YDB — test implementation

Status: handler and schema are prepared on isolated branch `test`. This is not a deployment confirmation. No production service or database was changed.

## Client protocol

The archived game HTML uses:
- host request: `{op:"host"}`
- guest request: `{op:"join", room, name}`
- signaling: `{op:"signal", cap, to, data}`
- server events: `sig:ready`, `peer:join`, `signal`, `peer:left`, `err`

The handler preserves the `Y1.` prefix expected by the game and returns an eight-character code as `Y1.CODE`.

## Files

- `yandex-function/index.js`: YDB-backed API Gateway WebSocket handler.
- `yandex-function/package.json`: Node.js 22+ package manifest with pinned SDK dependencies.
- `db/ydb/001-signaling.sql`: schema matching `rooms` and `room_members` used by the handler.

Raw capability tokens are not stored in YDB. `SIGNAL_HMAC_KEY` must be configured only in the test function environment and never committed.

## Behavior implemented

1. CONNECT acknowledges the WebSocket connection.
2. Host creates an eight-character room, stores the host and returns `sig:ready` with `Y1.CODE` and a signed capability.
3. Guest joins, is stored in `room_members`, and triggers `peer:join` to the host using the API Gateway Connections REST endpoint.
4. Signal relay validates capability, room membership, recipient role, payload size and restricts message types to offer/answer/candidate.
5. DISCONNECT removes the participant; guest disconnect notifies host; host disconnect invalidates the room and notifies guests.

## Blockers before live acceptance

- The 15-guest limit is currently a read-then-insert check and can race under simultaneous joins. Do not treat it as race-proof. A transactional/conditional counter design is required before production acceptance.
- The exact API Gateway operation-token location in Cloud Function context must be confirmed from real Gateway invocation logs/configuration. This source checks candidate paths but does not prove which one Yandex supplies.
- Verify the Connections `:send` endpoint, body shape and IAM authorization against the deployed test Gateway.
- DISCONNECT cleanup is best-effort. Expired rooms are rejected on join/signal; stale-row cleanup needs a scheduled/periodic strategy if disconnect events are lost.
- STUN-only ICE can fail on restrictive mobile NAT. Successful signaling is not proof of WebRTC connectivity.
- CREATE TABLE IF NOT EXISTS does not reconcile a table with a different existing schema. Inspect actual test DB table descriptions before applying SQL.

## Test configuration

Required environment:
- `YDB_ENDPOINT=grpcs://ydb.serverless.yandexcloud.net:2135`
- `YDB_DATABASE=<test database path>`
- `YDB_METADATA_CREDENTIALS=1` when required by selected runtime
- `SIGNAL_HMAC_KEY=<secret configured in provider console>`

Use only the dedicated `zomb-signal-test` service account and isolated test Gateway/function. Never commit IAM tokens, service-account keys, HMAC secrets or API keys.

## Acceptance sequence

1. Deploy only to isolated test function and run read-only YDB health query.
2. Confirm real CONNECT/MESSAGE/DISCONNECT event shapes.
3. Verify host creation and room/member rows.
4. Verify guest join and host receives peer:join.
5. Verify offer/answer/candidate relay in both directions.
6. Verify guest and host disconnect cleanup.
7. Repeat on PC + Android and assess ICE separately.

No production rollout is authorized.
