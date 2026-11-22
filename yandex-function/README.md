# YDB adapter for the Yandex signaling function

Draft only. This directory is not wired into the live function and is not deployed.

## Runtime

- Yandex Cloud Functions runtime: Node.js 22
- Package: `ydb-sdk@5.11.1`
- Authentication: metadata credentials from the function's attached service account
- No service-account key file, IAM token, or HMAC secret is stored in source

## Environment variables

Set these only in the isolated test function version:

- `YDB_ENDPOINT=grpcs://ydb.serverless.yandexcloud.net:2135`
- `YDB_DATABASE=<database path copied from the YDB overview>`
- `YDB_METADATA_CREDENTIALS=1`
- Optional: `YDB_CONNECT_TIMEOUT_MS=10000`

The service account `zomb-signal-test` must retain database-scoped access to this database.

## Current implementation

`ydb-client.cjs` provides:
- lazy, reusable driver initialization for warm function instances;
- environment-based metadata authentication;
- connection readiness timeout;
- read-only `SELECT 1 AS ready` health check;
- safe driver shutdown.

It deliberately does not create tables, mutate room data, or alter WebSocket behavior yet.

## Verification before integration

1. Install dependencies in a clean Node.js 22 environment.
2. Run syntax checks.
3. Unit-test missing environment variables and failed driver initialization with a mocked SDK.
4. Only then connect the existing WebSocket handler to this module.
5. Test YDB access from a separate test function version before changing any API Gateway integration.

Do not put database credentials or secrets in GitHub. Environment variable values belong in the Yandex Cloud function configuration.
