// Temporary, separate YDB connectivity probe. Do not use as the WebSocket handler.
'use strict';
const { Driver, getCredentialsFromEnv } = require('ydb-sdk');
function requiredEnv(name) { const v=process.env[name]; if(typeof v!=='string'||!v.trim()) throw new Error('Missing '+name); return v.trim(); }
let driverPromise;
async function getDriver(){
  if(!driverPromise) driverPromise=(async()=>{
    const driver=new Driver({endpoint:requiredEnv('YDB_ENDPOINT'),database:requiredEnv('YDB_DATABASE'),authService:getCredentialsFromEnv()});
    try { if(!await driver.ready(Number(process.env.YDB_CONNECT_TIMEOUT_MS||10000))) throw new Error('YDB readiness timeout'); return driver; }
    catch(e){try{await driver.destroy()}catch(_){} throw e;}
  })().catch(e=>{driverPromise=undefined;throw e;});
  return driverPromise;
}
exports.handler=async function(){
  try {
    const driver=await getDriver();
    const result=await driver.tableClient.withSession(session=>session.executeQuery('SELECT 1 AS ready'));
    if(!result?.resultSets?.[0]?.rows?.[0]) throw new Error('YDB health query returned no row');
    return {statusCode:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify({ok:true,ydb:'connected',probe:'SELECT 1'})};
  } catch(e) {
    console.error('YDB probe failed:',e?.message||'unknown error');
    return {statusCode:503,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify({ok:false,ydb:'unavailable'})};
  }
};
