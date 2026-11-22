# Temporary YDB probe

Deploy this as a separate temporary Cloud Function (e.g. `zomb-ydb-probe`). Do not replace `zomb-signal-test` with this handler: it does not implement WebSocket signaling.

Runtime: Node.js 22. Entry point: `index.handler`. Dependency: `ydb-sdk@5.11.1`.

Environment variables: `YDB_ENDPOINT`, `YDB_DATABASE`, `YDB_METADATA_CREDENTIALS=1`, optional `YDB_CONNECT_TIMEOUT_MS=10000`.

Attach service account `zomb-signal-test`. This probe only runs read-only `SELECT 1`; it does not create tables or modify data. Success returns HTTP 200 with `{ok:true,ydb:"connected",probe:"SELECT 1"}`; failure returns generic HTTP 503. Detailed errors are only in function logs.

This proves only connectivity and authentication, not schema, room lifecycle, WebSocket, concurrency or WebRTC.
