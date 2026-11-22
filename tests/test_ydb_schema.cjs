const fs = require('node:fs');
const assert = require('node:assert/strict');
const sql = fs.readFileSync(new URL('../db/ydb/001-signaling.sql', `file://${__filename}`), 'utf8');
for (const table of ['rooms', 'peers']) {
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, 'i'));
}
assert.match(sql, /PRIMARY KEY\\s*\\(room_code\\)/i);
assert.match(sql, /PRIMARY KEY\\s*\\(room_code,\\s*peer_id\\)/i);
assert.equal((sql.match(/TTL\\s*=\\s*Interval\\("PT1H"\\)\\s+ON\\s+expires_at_ms\\s+AS\\s+MILLISECONDS/gi) || []).length, 2);
assert.match(sql, /host_cap_hash\\s+Utf8\\s+NOT NULL/i);
assert.match(sql, /cap_hash\\s+Utf8\\s+NOT NULL/i);
assert.doesNotMatch(sql, /SIGNAL_HMAC_KEY|IAM_TOKEN|PRIVATE_KEY|ACCESS_KEY/i);
console.log('PASS: YDB signaling schema contains room/peer keys, expiry TTL and capability hashes; no secrets');
