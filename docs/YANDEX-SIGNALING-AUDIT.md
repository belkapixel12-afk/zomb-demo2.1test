# Yandex signaling parity audit

Status: source audit only; no deployment or production changes.

## Scope

Target behavior is the existing Cloudflare room/signaling contract, implemented by the recovered Worker in this archive. The intended Yandex replacement must keep game traffic on direct WebRTC (STUN only for this phase) and use API Gateway only for room coordination and signaling.

## Verified from the archived Cloudflare Worker

- `POST /api/room` creates an 8-character room code using the ambiguity-free alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- `/ws?room=CODE&role=host` registers the host in a Durable Object keyed by room code.
- `/ws?room=CODE&role=guest` admits guests only while a host is connected; the Worker draft caps guests at 15.
- The server emits `sig:ready` with role/peerId/room.
- A guest causes `peer:join` to be sent to the host.
- Signaling messages use `{t:"signal", to: peerId, data:{type:"offer"|"answer"|"candidate", ...}}`.
- Host disconnect closes guest sockets; guest disconnect emits `peer:left`.

## Verified from the archived game HTML

- The Yandex client currently uses `wss://d5dm8unk4qchhg2alrkh.hsvi2zuh.apigw.yandexcloud.net/ws`.
- Host sends `{op:"host"}`; guest sends `{op:"join", room, name}`.
- Yandex responses are expected to include `{t:"sig:ready", cap, room?}`.
- Subsequent signaling is wrapped as `{op:"signal", cap, to, data}`.
- The client requires a `Y1.`-prefixed room token up to 1,000 characters. This is not compatible with the Cloudflare 8-character room code contract.
- ICE configuration is STUN-only: Google STUN and `stun.cloudflare.com:3478`. No TURN server is configured.
- The archived adapter test is mocked; it verifies message formatting and queue behavior, not a deployed Gateway or two real devices.

## Important diagnosis

The two room protocols are not currently equivalent. The Yandex adapter has a capability-token protocol and a different room identifier format; Cloudflare uses a short room code and server-side room membership. Merely changing the WebSocket URL cannot make them interchangeable.

The earlier browser test showed that Yandex WebSocket host/join and offer/answer/candidate messages were delivered, but the tested ICE connection failed. That is evidence of signaling progress, not proof that real cross-device room joining works.

## Required Yandex Gateway behavior for parity

The Yandex server must provide equivalent semantics, even if its internal messages differ:

1. Host requests room creation; server allocates a collision-resistant 8-character code.
2. Host connection is registered under that code.
3. Guest joins by the same 8-character code.
4. Server rejects unknown/expired rooms and enforces a guest limit.
5. Server sends a stable peer ID and a join event to the host.
6. Server relays offer, answer, and ICE candidate messages to the addressed peer.
7. Server validates that each sender's capability belongs to that connection and room.
8. Disconnect removes the peer; host disconnect invalidates the room and informs guests.
9. Room lifetime/cleanup must work even when disconnect events are missing or delayed.
10. Payload size and rate limits must be enforced.

## Blocker before editing the live Yandex function

The archive does not contain the deployed Yandex Cloud Function source or its event payload examples. It contains the Yandex client adapter and mocked test only. Do not guess at API Gateway event fields, connection IDs, operation tokens, or REST send authorization.

To implement safely, use the exact current Cloud Function source and OpenAPI export, with secrets removed. Then adapt the server and client together and add tests for host/guest lifecycle, short room codes, relay routing, disconnects, invalid tokens, and reconnects.

## Safety boundary

- Keep all work on GitHub branch `test`.
- Do not modify `main`, production Cloudflare Worker, production databases, or deployed Yandex Gateway during this audit.
- Do not add TURN or paid compute resources in this phase.
- Do not put IAM tokens, HMAC secrets, API keys, or private keys in source control.
