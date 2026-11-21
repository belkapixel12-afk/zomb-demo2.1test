# ZOMB test-branch baseline

Status: investigation only. This branch is isolated from `main`.

## Source archive reviewed

The uploaded `ZOMB-CHECKPOINT-NOT-RELEASE.zip` contains:
- `index-TEST-NOT-RELEASE.html` (46,494,660 bytes)
- `worker-current-test.js`
- `worker-device-DRAFT.mjs`
- `worker-security-DRAFT.mjs`
- five synthetic tests and SQL migrations.

The archive's own `PROCHTI.txt` explicitly says this is a recovered, unreleased draft. Do not deploy it or apply its SQL to a production database.

## Checks run

Executed the five test scripts with Node.js 22.16.0 (the archive requests Node.js 24):
- `test_yandex_adapter.cjs`: PASS (mock WebSocket only)
- `test_client_state.cjs`: PASS (synthetic in-memory state)
- `test_device.mjs`: PASS (in-memory SQLite)
- `test_yandex_device.mjs`: exit 0 (mocked Yandex OAuth + in-memory SQLite)
- `test_google_device.mjs`: PASS (mocked Google OAuth + in-memory SQLite)

These tests do not verify real OAuth accounts, a deployed D1 database, the Yandex API Gateway, or two-device multiplayer.

## Findings and blockers

1. The game HTML currently points account requests at the test Cloudflare Worker `https://zomb-auth-test.zomb-game.workers.dev`. Its CORS handler allows wildcard origins, so email/password API requests from a local `file://` page are intended to work, subject to browser support and the test Worker being online. Google and Yandex OAuth flows explicitly require HTTPS, so they cannot complete from a local file URL; they return to the configured hosted game URL.
2. The Yandex WebSocket adapter points to `wss://d5dm8unk4qchhg2alrkh.hsvi2zuh.apigw.yandexcloud.net/ws`. The archive says this gateway was stopped after testing. The actual Yandex gateway function/configuration is not included, so its room-generation and signaling behavior cannot be repaired or verified from this archive alone.
3. The Yandex room input currently permits up to 1,000 characters and expects a `Y1.`-prefixed room value. The mocked adapter test only covers a short sample `Y1.Ab_c`; it does not establish the production gateway's actual room-code format. Do not truncate a live room token blindly.
4. The Cloudflare Worker draft's `/api/room` creates an eight-character code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. That is separate from the Yandex gateway adapter.
5. `worker-device-DRAFT.mjs` adds a three-minute exclusive-device lease. It depends on the `active_device_leases` table and related migrations. It is not a drop-in replacement for the current Worker until schema and lifecycle behavior are validated.
6. `worker-security-DRAFT.mjs` includes additional Google OAuth callback/session hardening but does not include the exclusive-device lease changes.

## Next required inputs before a safe integration

- The deployed Yandex API Gateway / Cloud Function source (or its exported configuration and logs), plus confirmation whether that gateway is intended to be restarted.
- The intended test Worker environment bindings and D1 schema state. Do not paste secrets; use placeholder names and configure secrets in the provider dashboard.
- Confirmation of the exact desired public room-code format (recommended: 8 uppercase characters from an ambiguity-free alphabet) and the actual gateway protocol contract.

No production services, database migrations, or `main` branch files were changed during this review.
