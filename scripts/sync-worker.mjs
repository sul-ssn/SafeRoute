import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Pool } from 'pg';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const { persistImport } = await import('../src/imports.ts');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for sync worker');
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const interval = Number(process.env.SYNC_POLL_SECONDS || 60) * 1000;
const qamqorSyncMinutes = Number(process.env.QAMQOR_SYNC_INTERVAL_MINUTES || 1440);
const qamqorDelayMs = Number(process.env.QAMQOR_SYNC_DELAY_MS || 1000);
if (!Number.isInteger(qamqorSyncMinutes) || qamqorSyncMinutes < 15 || !Number.isInteger(qamqorDelayMs) || qamqorDelayMs < 0 || qamqorDelayMs > 60000) throw new Error('Qamqor sync interval must be >=15 minutes and request delay 0..60000 ms');

const qamqorLayers = {
  'qamqor-crime-astana-2026': { eventType: 'crime', url: 'https://gis.kgp.kz/arcgis/rest/services/KPSSU/crime/FeatureServer/1', cityField: 'city_code', dateField: 'dat_sover', categoryField: 'crime_code', classificationField: 'hard_code' },
  'qamqor-dtp-astana-2026': { eventType: 'traffic_accident', url: 'https://gis.kgp.kz/arcgis/rest/services/KPSSU/DTP/FeatureServer/0', cityField: 'area_code', dateField: 'rta_date', categoryField: 'fd1r08p1', classificationField: 'type_dtp' },
};
const astanaBoundaryUrl = 'https://gis.kgp.kz/arcgis/rest/services/KPSSU/Area_regions/FeatureServer/1/query';
let boundaryCache;

function isPrivateAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a,b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (version === 6) { const normalized = address.toLowerCase(); return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:') || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.'); }
  return true;
}

async function fetchSource(source) {
  const url = new URL(source.sync_url);
  if (url.protocol !== 'https:' || url.username || url.password || isIP(url.hostname)) throw new Error('sync URL must be an HTTPS public hostname');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('sync URL resolves to a non-public address');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'manual', headers: { 'User-Agent': 'SafeRoute-source-sync/1.0', Accept: 'text/csv, application/geo+json, application/json' } });
    if (response.status >= 300 && response.status < 400) throw new Error('redirects are not followed by the sync worker');
    if (!response.ok) throw new Error(`source returned HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > 2 * 1024 * 1024) throw new Error('source file exceeds 2 MiB');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 2 * 1024 * 1024) throw new Error('source file exceeds 2 MiB');
    return buffer;
  } finally { clearTimeout(timer); }
}

async function fetchQamqorJson(url) {
  if (url.protocol !== 'https:' || url.hostname !== 'gis.kgp.kz' || url.username || url.password) throw new Error('Qamqor adapter may access only the confirmed public gis.kgp.kz endpoint');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('Qamqor endpoint resolved to a non-public address');
  for (let attempt = 0; attempt < 3; attempt++) {
    if (qamqorDelayMs) await new Promise((resolve) => setTimeout(resolve, qamqorDelayMs));
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'manual', headers: { 'User-Agent': 'SafeRoute-Qamqor-sync/1.0', Accept: 'application/json' } });
      if (response.status >= 300 && response.status < 400) throw new Error('Qamqor redirect not followed');
      if ((response.status === 429 || response.status >= 500) && attempt < 2) { await response.body?.cancel(); await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** attempt))); continue; }
      if (!response.ok) throw new Error(`Qamqor returned HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.error) throw new Error(`Qamqor ArcGIS error: ${payload.error.message || 'request failed'}`);
      return payload;
    } finally { clearTimeout(timer); }
  }
  throw new Error('Qamqor request retry limit reached');
}

function containsPoint(rings, x, y) {
  let inside = false;
  for (const ring of rings ?? []) {
    let ringInside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
      if (Math.abs(cross) < 1e-10 && x >= Math.min(xi, xj) - 1e-10 && x <= Math.max(xi, xj) + 1e-10 && y >= Math.min(yi, yj) - 1e-10 && y <= Math.max(yi, yj) + 1e-10) return true;
      if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi) ringInside = !ringInside;
    }
    if (ringInside) inside = !inside;
  }
  return inside;
}

async function getAstanaBoundary() {
  if (!boundaryCache) {
    const url = new URL(astanaBoundaryUrl);
    url.search = new URLSearchParams({ f: 'json', where: "nameobl = 'Астана'", outFields: 'nameobl', returnGeometry: 'true', outSR: '4326' }).toString();
    boundaryCache = fetchQamqorJson(url).then((payload) => {
      const rings = (payload.features ?? []).flatMap((feature) => feature.geometry?.rings ?? []);
      if (!rings.length) throw new Error('Astana administrative boundary was unavailable; no incident data imported');
      return rings;
    }).catch((error) => { boundaryCache = undefined; throw error; });
  }
  return boundaryCache;
}

function sourceDate(value, timeZone) {
  if (value == null || value === '') return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return null;
  // The Qamqor DTP layer declares its field as Central Asia Standard Time (UTC+06).
  // Keep that source calendar even though current Asia/Almaty civil time is UTC+05.
  if (timeZone === 'UTC+06') return new Date(date.getTime() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return timeZone === 'UTC' ? date.toISOString().slice(0, 10) : new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

async function fetchQamqorSource(source) {
  const layer = qamqorLayers[source.id];
  if (!layer || source.sync_url !== layer.url) throw new Error('Qamqor source ID and allow-listed URL do not match');
  const boundary = await getAstanaBoundary();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  const tomorrow = new Date(`${today}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const endDate = tomorrow.toISOString().slice(0, 10);
  const startDate = layer.eventType === 'traffic_accident' ? '2025-12-31' : '2026-01-01';
  const where = `${layer.cityField} = '1971' AND ${layer.dateField} >= DATE '${startDate}' AND ${layer.dateField} < DATE '${endDate}'`;
  const outFields = `${layer.dateField},${layer.categoryField},${layer.classificationField}`;
  const features = []; const pageSize = 1000; let offset = 0;
  for (;;) {
    const url = new URL(`${layer.url}/query`);
    url.search = new URLSearchParams({ f: 'json', where, outFields, returnGeometry: 'true', outSR: '4326', resultOffset: String(offset), resultRecordCount: String(pageSize), orderByFields: `${layer.dateField} ASC` }).toString();
    const payload = await fetchQamqorJson(url);
    const page = payload.features ?? [];
    for (const feature of page) {
      const lon = Number(feature.geometry?.x), lat = Number(feature.geometry?.y);
      const occurredOn = sourceDate(feature.attributes?.[layer.dateField], layer.eventType === 'traffic_accident' ? 'UTC+06' : 'UTC');
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !occurredOn || occurredOn < '2026-01-01' || occurredOn > today || !containsPoint(boundary, lon, lat)) continue;
      const properties = feature.attributes ?? {};
      const categoryCode = String(properties[layer.categoryField] ?? 'unknown').trim() || 'unknown';
      const classificationCode = String(properties[layer.classificationField] ?? '').trim();
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {
        event_type: layer.eventType, occurred_on: occurredOn, category: categoryCode,
        category_code: categoryCode, classification_code: classificationCode,
        source_attribution: 'Информация получена с официального интернет-портала qamqor.gov.kz',
      } });
    }
    offset += page.length;
    if (!payload.exceededTransferLimit && page.length < pageSize) break;
    if (!page.length) break;
  }
  return Buffer.from(JSON.stringify({ type: 'FeatureCollection', features }));
}

async function claimDue() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query(`SELECT * FROM data_sources WHERE sync_enabled AND next_sync_at<=now() ORDER BY next_sync_at LIMIT 10 FOR UPDATE SKIP LOCKED`);
    const jobs = [];
    for (const source of due.rows) {
      const run = await client.query(`INSERT INTO source_sync_runs(source_id,status,message) VALUES($1,'running','Synchronization started') RETURNING id`, [source.id]);
      const configuredInterval = source.sync_adapter === 'qamqor-arcgis-v1' ? qamqorSyncMinutes : source.sync_interval_minutes;
      await client.query(`UPDATE data_sources SET sync_interval_minutes=$2,next_sync_at=now() + make_interval(mins=>$2),updated_at=now() WHERE id=$1`, [source.id, configuredInterval]);
      jobs.push({ source, runId: run.rows[0].id });
    }
    await client.query('COMMIT'); return jobs;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function updateRun(runId, status, message, result = {}) {
  await pool.query(`UPDATE source_sync_runs SET status=$2,finished_at=now(),fetched_rows=$3,inserted_rows=$4,duplicate_rows=$5,message=$6 WHERE id=$1`,
    [runId, status, result.totalRows ?? 0, result.acceptedRows ?? 0, result.duplicateRows ?? 0, message]);
}

async function poll() {
  const lockClient = await pool.connect();
  try {
    if (!(await lockClient.query("SELECT pg_try_advisory_lock(72026013) AS locked")).rows[0].locked) return;
    try {
    const jobs = await claimDue();
    for (const { source, runId } of jobs) {
      try {
        if (source.data_mode !== 'real') throw new Error('only confirmed REAL sources may sync');
        if (source.sync_adapter === 'qamqor-arcgis-v1') {
          const buffer = await fetchQamqorSource(source);
          const imported = await persistImport(`sync-${source.id}.geojson`, buffer, { sourceId: source.id });
          const job = imported.job;
          await updateRun(runId, job.status === 'completed' ? 'completed' : 'failed', job.status === 'completed' ? `Qamqor ArcGIS synchronized; ${job.rejected_rows} invalid or withheld records rejected.` : 'Qamqor returned rows that failed validation.', { totalRows: job.total_rows, acceptedRows: job.accepted_rows, duplicateRows: job.duplicate_rows });
          continue;
        }
        if (source.sync_adapter !== 'https-file-v1') { await updateRun(runId, 'adapter_unconfigured', `Adapter '${source.sync_adapter}' is not registered; no request made.`); continue; }
        if (!source.sync_file_format) throw new Error('sync_file_format must be csv or geojson');
        const buffer = await fetchSource(source);
        const imported = await persistImport(`sync-${source.name}.${source.sync_file_format}`, buffer, { sourceId: source.id });
        const job = imported.job;
        await updateRun(runId, job.status === 'completed' ? 'completed' : 'failed', job.status === 'completed' ? 'Source synchronized.' : 'Source file had rejected rows.', { totalRows: job.total_rows, acceptedRows: job.accepted_rows, duplicateRows: job.duplicate_rows });
      } catch (error) { await updateRun(runId, 'failed', error instanceof Error ? error.message : 'Unknown synchronization error'); }
    }
    } finally { await lockClient.query('SELECT pg_advisory_unlock(72026013)'); }
  } finally { lockClient.release(); }
}

console.log(`SafeRoute sync worker polling every ${Math.round(interval / 1000)} seconds; Qamqor interval ${qamqorSyncMinutes} minutes; configured adapters: qamqor-arcgis-v1, https-file-v1`);
if (process.env.SYNC_RUN_ONCE === '1') {
  await poll().catch((error) => { console.error('One-shot synchronization poll failed:', error); process.exitCode = 1; });
  await pool.end();
} else {
  await poll().catch((error) => console.error('Initial synchronization poll failed:', error));
  setInterval(() => { void poll().catch((error) => console.error('Synchronization poll failed:', error)); }, interval);
}
