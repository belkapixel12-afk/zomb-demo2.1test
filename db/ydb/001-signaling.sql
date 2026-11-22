-- ZOMB Yandex WebSocket signaling schema for the current index.js handler.
-- Target: isolated test database only. Never apply to production.
-- CREATE TABLE IF NOT EXISTS does not alter an existing table with another schema.
CREATE TABLE IF NOT EXISTS rooms (
    room_code String NOT NULL,
    host_connection_id String NOT NULL,
    created_at Uint64 NOT NULL,
    expires_at Uint64 NOT NULL,
    status String NOT NULL,
    PRIMARY KEY (room_code)
);
CREATE TABLE IF NOT EXISTS room_members (
    room_code String NOT NULL,
    connection_id String NOT NULL,
    role String NOT NULL,
    display_name String NOT NULL,
    joined_at Uint64 NOT NULL,
    last_seen_at Uint64 NOT NULL,
    PRIMARY KEY (room_code, connection_id)
);
