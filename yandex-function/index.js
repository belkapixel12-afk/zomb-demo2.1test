'use strict';

// ZOMB Yandex API Gateway WebSocket signaling, YDB-backed TEST build.
// Matches the existing YDB tables: rooms + room_members.
// Keep this in the isolated test function until PC <-> Android tests pass.

const crypto = require('node:crypto');
const { Driver, getCredentialsFromEnv, TypedData, StatusCode } = require('ydb-sdk');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS = 57 * 60 * 1000;
const MAX_GUESTS = 15;
const MAX_BODY_BYTES = 30_000;

function env(name) {
  const v = process.env[name];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing environment variable: ${name}`);
  return v.trim();
}
function jsonResponse(value, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(value)
  };
}
function fail(message, statusCode = 200) {
  return jsonResponse({ t: 'err', msg: String(message || 'Signaling error').slice(0, 180) }, statusCode);
}
function q(value) { return JSON.stringify(String(value)); }
function safeName(value) {
  return String(value || 'Игрок').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 20) || 'Игрок';
}
function randomRoomCode() {
  const b = crypto.randomBytes(8);
  let out = '';
  for (const x of b) out += ALPHABET[x % ALPHABET.length];
  return out;
}
function normalizeRoom(value) {
  return String(value || '').trim().toUpperCase().replace(/^Y1\./, '').replace(/[^A-Z0-9]/g, '').slice(0, 8);
}
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function signCap(payload) {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const mac = crypto.createHmac('sha256', env('SIGNAL_HMAC_KEY')).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verifyCap(token, connectionId) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', env('SIGNAL_HMAC_KEY')).update(parts[0]).digest();
  let actual;
  try { actual = Buffer.from(parts[1], 'base64url'); } catch (_) { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (_) { return null; }
  if (!p || p.cid !== connectionId || !p.room || !p.role || !Number.isFinite(p.exp) || p.exp <= Date.now()) return null;
  return p;
}
function rowCell(row, index, name) {
  if (row && Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  const v = Array.isArray(row) ? row[index] : row?.items?.[index];
  if (v == null) return undefined;
  if (typeof v !== 'object') return v;
  if (v.textValue !== undefined) return v.textValue;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.uint64Value !== undefined) return Number(v.uint64Value);
  if (v.int64Value !== undefined) return Number(v.int64Value);
  if (v.bytesValue !== undefined) return Buffer.from(v.bytesValue, 'base64').toString('utf8');
  if (v.value !== undefined) return v.value;
  return v;
}
function rowsOf(result) { const set = result?.resultSets?.[0]; return set ? TypedData.createNativeObjects(set) : []; }

let driverPromise;
async function getDriver() {
  if (!driverPromise) {
    driverPromise = (async () => {
      const driver = new Driver({
        endpoint: env('YDB_ENDPOINT'),
        database: env('YDB_DATABASE'),
        authService: getCredentialsFromEnv()
      });
      const ready = await driver.ready(10000);
      if (!ready) throw new Error('YDB driver readiness timeout');
      return driver;
    })().catch((e) => { driverPromise = undefined; throw e; });
  }
  return driverPromise;
}
function transient(e) {
  const status = e?.constructor?.status ?? e?.status;
  return [StatusCode.ABORTED, StatusCode.OVERLOADED, StatusCode.CLIENT_RESOURCE_EXHAUSTED].includes(status)
    || e?.code === 8 || /RESOURCE_EXHAUSTED|Transaction not found|Overloaded/i.test(String(e?.message || ''));
}
async function query(yql) {
  for (let attempt = 0; ; attempt++) {
    try { const driver = await getDriver(); return await driver.tableClient.withSession(session => session.executeQuery(yql)); }
    catch (e) { if (!transient(e) || attempt >= 5) throw e; await sleep(Math.min(2400, 250 * 2 ** attempt) + Math.random() * 350); }
  }
}
async function selectRows(yql) { return rowsOf(await query(yql)); }

function getAccessToken(context) {
  const candidates = [
    context?.token,
    context?.token?.access_token,
    context?.access_token,
    context?.requestContext?.apiGateway?.operationToken?.access_token
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate.access_token === 'string') return candidate.access_token;
  }
  return '';
}
async function sendToConnection(connectionId, message, context) {
  const token = getAccessToken(context);
  if (!token) throw new Error('API Gateway IAM token is missing in function context');
  const response = await fetch(`https://apigateway-connections.api.cloud.yandex.net/apigateways/websocket/v1/connections/${encodeURIComponent(connectionId)}:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ data: Buffer.from(JSON.stringify(message), 'utf8').toString('base64'), type: 'TEXT' }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`WebSocket send failed: HTTP ${response.status}`);
}
async function roomByCode(code) {
  const rows = await selectRows(`SELECT host_connection_id, created_at, expires_at, status FROM rooms WHERE room_code = ${q(code)};`);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    host: String(rowCell(r, 0, 'host_connection_id') ?? ''),
    createdAt: Number(rowCell(r, 1, 'created_at') ?? 0),
    expiresAt: Number(rowCell(r, 2, 'expires_at') ?? 0),
    status: String(rowCell(r, 3, 'status') ?? '')
  };
}
async function memberByConnection(connectionId) {
  const rows = await selectRows(`SELECT room_code, role, display_name FROM room_members WHERE connection_id = ${q(connectionId)};`);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    room: String(rowCell(r, 0, 'room_code') ?? ''),
    role: String(rowCell(r, 1, 'role') ?? ''),
    name: String(rowCell(r, 2, 'display_name') ?? 'Игрок')
  };
}
async function membersInRoom(code) {
  const rows = await selectRows(`SELECT connection_id, role, display_name FROM room_members WHERE room_code = ${q(code)};`);
  return rows.map((r) => ({
    connectionId: String(rowCell(r, 0, 'connection_id') ?? ''),
    role: String(rowCell(r, 1, 'role') ?? ''),
    name: String(rowCell(r, 2, 'display_name') ?? 'Игрок')
  }));
}
async function deleteRoom(code) {
  await query(`DELETE FROM room_members WHERE room_code = ${q(code)};`);
  await query(`DELETE FROM rooms WHERE room_code = ${q(code)};`);
}
function roomCap(room, connectionId, role, expiresAt) {
  return signCap({ room, cid: connectionId, role, exp: expiresAt });
}

async function onHost(connectionId, name) {
  const now = Date.now();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomRoomCode();
    const exists = await roomByCode(code);
    if (exists && exists.expiresAt > now && exists.status === 'active') continue;
    if (exists) await deleteRoom(code);
    const expiresAt = now + ROOM_TTL_MS;
    await query(`UPSERT INTO rooms (room_code, host_connection_id, created_at, expires_at, status) VALUES (${q(code)}, ${q(connectionId)}, ${now}, ${expiresAt}, "active");`);
    await query(`UPSERT INTO room_members (room_code, connection_id, role, display_name, joined_at, last_seen_at) VALUES (${q(code)}, ${q(connectionId)}, "host", ${q(name)}, ${now}, ${now});`);
    return { t: 'sig:ready', role: 'host', peerId: 'host', room: `Y1.${code}`, cap: roomCap(code, connectionId, 'host', expiresAt) };
  }
  throw new Error('Не удалось подобрать свободный код комнаты');
}

const JOIN_COOLDOWN_MS = 300;
const JOIN_QUEUE_TIMEOUT_MS = 18000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function dbValue(row, name) { return rowCell(row, 0, name); }
async function tryJoinQueue(code, connectionId, name) {
  const driver = await getDriver();
  return driver.tableClient.withSession(async session => {
    const meta = await session.beginTransaction({serializableReadWrite:{}});
    const tx = {txId:meta.id};
    let committed = false;
    try {
      const rooms = rowsOf(await session.executeQuery(`SELECT host_connection_id, expires_at, status FROM rooms WHERE room_code = ${q(code)};`, {}, tx));
      const row = rooms[0];
      if (!row || String(dbValue(row,'status')) !== 'active' || Number(dbValue(row,'expires_at')) <= Date.now()) throw new Error('Комната не найдена или срок её действия истёк');
      const host = String(dbValue(row,'host_connection_id'));
      if (host === connectionId) throw new Error('Хост не может войти в свою комнату как игрок');
      const members = rowsOf(await session.executeQuery(`SELECT connection_id, role, joined_at FROM room_members WHERE room_code = ${q(code)};`, {}, tx)).map(r=>({id:String(dbValue(r,'connection_id')),role:String(dbValue(r,'role')),at:Number(dbValue(r,'joined_at'))}));
      const own = members.find(m=>m.id===connectionId);
      if (!own || own.role !== 'queue') throw new Error('Вход отменён или уже выполнен');
      const guests = members.filter(m=>m.role==='guest');
      if (guests.length >= MAX_GUESTS) throw new Error('Комната заполнена');
      const now = Date.now();
      const queue = members.filter(m=>m.role==='queue' && m.at > now-JOIN_QUEUE_TIMEOUT_MS-5000).sort((a,b)=>a.at-b.at || a.id.localeCompare(b.id));
      const latest = guests.reduce((t,m)=>Math.max(t,m.at),0);
      const place = Math.max(0, queue.findIndex(m => m.id === connectionId));
      if (place > 0 || now-latest < JOIN_COOLDOWN_MS) return {waitMs: Math.min(2500, 500 + place*300 + Math.floor(Math.random()*400))};
      const stamp=Date.now();
      await session.executeQuery(`UPSERT INTO room_members (room_code, connection_id, role, display_name, joined_at, last_seen_at) VALUES (${q(code)}, ${q(connectionId)}, "guest", ${q(name)}, ${stamp}, ${stamp});`, {}, tx);
      await session.commitTransaction(tx); committed=true;
      return {host,expiresAt:Number(dbValue(row,'expires_at'))};
    } finally { if (!committed) try { await session.rollbackTransaction(tx); } catch (_) {} }
  });
}
async function onJoin(connectionId, roomInput, name, context) {
  const code = normalizeRoom(roomInput);
  if (!/^[A-Z0-9]{8}$/.test(code)) throw new Error('Неверный код комнаты');
  const room = await roomByCode(code);
  if (!room || room.status !== 'active' || room.expiresAt <= Date.now()) throw new Error('Комната не найдена или срок её действия истёк');
  if (room.host === connectionId) throw new Error('Хост не может войти в свою комнату как игрок');
  if (await memberByConnection(connectionId)) throw new Error('Это соединение уже находится в комнате');
  const queuedAt=Date.now();
  await query(`UPSERT INTO room_members (room_code, connection_id, role, display_name, joined_at, last_seen_at) VALUES (${q(code)}, ${q(connectionId)}, "queue", ${q(name)}, ${queuedAt}, ${queuedAt});`);
  let joined=false;
  try {
    let approved=null;
    const deadline=Date.now()+JOIN_QUEUE_TIMEOUT_MS;
    while (Date.now()<deadline) {
      try { approved=await tryJoinQueue(code,connectionId,name); }
      catch (e) { if (!transient(e)) throw e; }
      if (approved && !approved.waitMs) break;
      await sleep(approved?.waitMs || 650+Math.floor(Math.random()*750));
      approved=null;
    }
    if (!approved) throw new Error('Очередь входа занята. Попробуй ещё раз.');
    const cap=roomCap(code,connectionId,'guest',approved.expiresAt);
    try { await sendToConnection(approved.host,{t:'peer:join',peerId:connectionId,name},context); }
    catch(e) { throw new Error(`Не удалось уведомить хоста: ${e.message}`); }
    joined=true;
    return {t:'sig:ready',role:'guest',peerId:connectionId,room:`Y1.${code}`,cap};
  } finally { if(!joined) try { await query(`DELETE FROM room_members WHERE room_code = ${q(code)} AND connection_id = ${q(connectionId)};`); } catch(_) {} }
}

async function onSignal(connectionId, message, context) {
  const cap = verifyCap(message.cap, connectionId);
  if (!cap) throw new Error('Недействительный или истёкший capability token');
  const sender = await memberByConnection(connectionId);
  if (!sender || sender.room !== cap.room || sender.role !== cap.role) throw new Error('Соединение не состоит в этой комнате');
  const room = await roomByCode(cap.room);
  if (!room || room.expiresAt <= Date.now() || room.status !== 'active') throw new Error('Комната больше не активна');
  const targetId = message.to === 'host' ? room.host : String(message.to || '');
  if (!targetId || targetId === connectionId) throw new Error('Неверный получатель сигнала');
  const target = await memberByConnection(targetId);
  if (!target || target.room !== cap.room) throw new Error('Игрок-получатель уже отключился');
  if (sender.role === 'guest' && target.role !== 'host') throw new Error('Игрок может отправлять сигнал только хосту');
  if (sender.role === 'host' && target.role !== 'guest') throw new Error('Хост может отправлять сигнал только игроку');
  const data = message.data;
  if (!data || typeof data !== 'object' || JSON.stringify(data).length > 24000) throw new Error('Некорректные данные WebRTC');
  await sendToConnection(targetId, { t: 'signal', from: connectionId, data }, context);
  return { t: 'noop' };
}

async function onDisconnect(connectionId, context) {
  const member = await memberByConnection(connectionId);
  if (!member) return { ok: true };
  const room = await roomByCode(member.room);
  await query(`DELETE FROM room_members WHERE room_code = ${q(member.room)} AND connection_id = ${q(connectionId)};`);
  if (member.role === 'queue') return {ok:true};
  if (member.role === 'host') {
    const others = await membersInRoom(member.room);
    for (const peer of others) {
      try { await sendToConnection(peer.connectionId, { t: 'err', msg: 'Хост закрыл комнату' }, context); } catch (_) {}
    }
    await deleteRoom(member.room);
  } else if (room?.host) {
    try { await sendToConnection(room.host, { t: 'peer:left', peerId: connectionId, name: member.name }, context); } catch (_) {}
  }
  return { ok: true };
}

function decodeBody(event) {
  if (typeof event?.body !== 'string') return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new Error('Сообщение слишком большое');
  try { return JSON.parse(raw); } catch (_) { throw new Error('Неверный JSON'); }
}

exports.handler = async function (event, context) {
  const rc = event?.requestContext || {};
  const connectionId = String(rc.connectionId || '');
  const eventType = String(rc.eventType || '').toUpperCase();
  if (!connectionId || connectionId.length > 50) return jsonResponse({ error: 'Missing WebSocket connection ID' }, 400);
  try {
    if (eventType === 'CONNECT') return jsonResponse({ ok: true });
    if (eventType === 'DISCONNECT') return jsonResponse(await onDisconnect(connectionId, context));
    if (eventType !== 'MESSAGE') return jsonResponse({ ok: true });
    const message = decodeBody(event);
    const op = String(message.op || '');
    if (op === 'ping') return jsonResponse({ t: 'pong' });
    const name = safeName(message.name);
    if (op === 'host') return jsonResponse(await onHost(connectionId, name));
    if (op === 'join') return jsonResponse(await onJoin(connectionId, message.room, name, context));
    if (op === 'signal') return jsonResponse(await onSignal(connectionId, message, context));
    return fail('Неизвестная команда');
  } catch (error) {
    const message = transient(error) ? 'Сервер занят. Подожди немного и попробуй снова.' : String(error?.message || error || 'Signaling error');
    // Never echo tokens or environment values to a connected client.
    return fail(message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 180));
  }
};
