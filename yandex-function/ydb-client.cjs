'use strict';

// Isolated YDB connection helper for the Yandex Cloud Function (Node.js 22).
// Does not create tables or modify any data. It only opens a driver and can
// execute a read-only health check. Room/peer operations will be added later.

const { Driver, getCredentialsFromEnv } = require('ydb-sdk');

let driverPromise = null;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

async function getDriver() {
  if (driverPromise) return driverPromise;

  driverPromise = (async () => {
    const endpoint = requiredEnv('YDB_ENDPOINT');
    const database = requiredEnv('YDB_DATABASE');
    const authService = getCredentialsFromEnv();
    const driver = new Driver({ endpoint, database, authService });

    try {
      const timeoutMs = Number(process.env.YDB_CONNECT_TIMEOUT_MS || 10000);
      const ready = await driver.ready(timeoutMs);
      if (!ready) throw new Error('YDB driver did not become ready before timeout');
      return driver;
    } catch (error) {
      try { await driver.destroy(); } catch (_) {}
      throw error;
    }
  })().catch((error) => {
    driverPromise = null;
    throw error;
  });

  return driverPromise;
}

async function checkConnection() {
  const driver = await getDriver();
  return driver.tableClient.withSession(async (session) => {
    const result = await session.executeQuery('SELECT 1 AS ready');
    const row = result && result.resultSets &&
      result.resultSets[0] && result.resultSets[0].rows &&
      result.resultSets[0].rows[0];
    if (!row) throw new Error('YDB health query returned no rows');
    return { ok: true };
  });
}

async function closeDriver() {
  const pending = driverPromise;
  driverPromise = null;
  if (!pending) return;
  try {
    const driver = await pending;
    await driver.destroy();
  } catch (_) {
    // Shutdown must not mask the original function result/error.
  }
}

module.exports = { getDriver, checkConnection, closeDriver };
