-- ZOMB Yandex WebSocket signaling schema
-- Target: the dedicated Serverless YDB database "zomb-signaling".
-- Apply ONLY to the test database after reviewing this file.
-- The handler must still check expires_at_ms on every read; TTL deletion is asynchronous.

CREATE TABLE IF NOT EXISTS rooms (
    room_code Utf8 NOT NULL,
    host_connection_id Utf8 NOT NULL,
    host_cap_hash Utf8 NOT NULL,
    created_at_ms Uint64 NOT NULL,
    expires_at_ms Uint64 NOT NULL,
    guest_count Uint32 NOT NULL,
    status Utf8 NOT NULL,
    PRIMARY KEY (room_code)
)
WITH (
    TTL = Interval("PT1H") ON expires_at_ms AS MILLISECONDS
);

CREATE TABLE IF NOT EXISTS peers (
    room_code Utf8 NOT NULL,
    peer_id Utf8 NOT NULL,
    connection_id Utf8 NOT NULL,
    role Utf8 NOT NULL,
    display_name Utf8 NOT NULL,
    cap_hash Utf8 NOT NULL,
    created_at_ms Uint64 NOT NULL,
    expires_at_ms Uint64 NOT NULL,
    PRIMARY KEY (room_code, peer_id)
)
WITH (
    TTL = Interval("PT1H") ON expires_at_ms AS MILLISECONDS
);
