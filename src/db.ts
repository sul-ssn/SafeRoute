import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { RiskSource } from './risk.ts';

const DATABASE_URL = process.env.DATABASE_URL;
const globalDb = globalThis as typeof globalThis & { saferoutePool?: Pool };

export class DatabaseUnavailableError extends Error {
  constructor() { super('PostgreSQL недоступен. Проверьте DATABASE_URL и запустите миграции.'); this.name = 'DatabaseUnavailableError'; }
}

export function getPool() {
  if (!DATABASE_URL) throw new DatabaseUnavailableError();
  globalDb.saferoutePool ??= new Pool({ connectionString: DATABASE_URL, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
  return globalDb.saferoutePool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) {
  return getPool().query<T>(sql, values);
}

export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export type IncidentQuery = { west?: number; south?: number; east?: number; north?: number; from?: string; to?: string; category?: string; eventType?: string; sourceId?: string; limit?: number; offset?: number };

function incidentWhere(filters: IncidentQuery) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const add = (expression: (param: string) => string, value: unknown) => { values.push(value); clauses.push(expression(`$${values.length}`)); };
  if (filters.west !== undefined && filters.south !== undefined && filters.east !== undefined && filters.north !== undefined) {
    add((p) => `(i.geom && ST_MakeEnvelope(${p}, $${values.length + 1}, $${values.length + 2}, $${values.length + 3}, 4326))`, filters.west);
    values.push(filters.south, filters.east, filters.north);
  }
  if (filters.from) add((p) => `i.occurred_at >= ${p}::date`, filters.from);
  if (filters.to) add((p) => `i.occurred_at <= ${p}::date`, filters.to);
  if (filters.category) add((p) => `i.category = ${p}`, filters.category);
  if (filters.eventType) add((p) => `i.event_type = ${p}`, filters.eventType);
  if (filters.sourceId) add((p) => `i.source_id = ${p}`, filters.sourceId);
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

export async function listIncidents(filters: IncidentQuery = {}) {
  const { where, values } = incidentWhere(filters);
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  const offset = Math.max(filters.offset ?? 0, 0);
  const countResult = await query<{ total: string }>(`SELECT count(*)::text AS total FROM incidents i ${where}`, values);
  const result = await query(`SELECT i.id::text AS id, i.external_id, i.event_type, i.category, i.category_code, i.classification_code, i.source_attribution, i.occurred_at::text AS occurred_at, i.is_synthetic,
      ST_X(i.geom) AS lon, ST_Y(i.geom) AS lat, i.spatial_precision_m,
      s.id AS source_id, s.name AS source_name, s.source_url, s.license_notes, s.data_mode,
      CASE WHEN i.geom IS NULL THEN NULL ELSE ST_AsGeoJSON(i.geom)::jsonb END AS geometry
    FROM incidents i JOIN data_sources s ON s.id=i.source_id ${where}
    ORDER BY i.occurred_at DESC NULLS LAST, i.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
  [...values, limit, offset]);
  return { items: result.rows, total: Number(countResult.rows[0]?.total ?? 0) };
}

export type RouteRiskPeriod = { from: string; to: string };

export async function getRiskRecords(geometry: { type: 'LineString'; coordinates: [number, number][] }, period: RouteRiskPeriod) {
  const [result, sourceResult] = await Promise.all([
    query<{ event_type: 'crime' | 'traffic_accident'; category: string; category_code: string; classification_code: string | null; occurredAt: string; lat: number; lon: number; precision_m: number | null; source_precision_m: number | null; source_id: string; source_name: string }>(`WITH route AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1),4326)::geography AS path)
      SELECT i.event_type, i.category, i.category_code, i.classification_code, i.occurred_at::text AS "occurredAt", ST_Y(i.geom) AS lat, ST_X(i.geom) AS lon,
        i.spatial_precision_m AS precision_m, s.spatial_precision_m AS source_precision_m, s.id AS source_id, s.name AS source_name
      FROM incidents i JOIN data_sources s ON s.id=i.source_id CROSS JOIN route r
      WHERE s.data_mode='real' AND i.is_synthetic=false AND i.event_type IN ('crime','traffic_accident')
        AND i.geom IS NOT NULL AND i.occurred_at BETWEEN $2::date AND $3::date
        AND ST_DWithin(i.geom::geography, r.path, 150)`, [JSON.stringify(geometry), period.from, period.to]),
    query<RiskSource>(`SELECT s.id,s.name,s.source_url,s.attribution,s.coverage_start::text,s.coverage_end::text,
        s.coverage_completeness,s.spatial_precision_m,s.retrieved_at,
        max(i.occurred_at)::text AS last_event_date,count(i.id)::int AS record_count,
        CASE WHEN s.id='qamqor-crime-astana-2026' THEN 'crime' ELSE 'traffic_accident' END AS event_type
      FROM data_sources s LEFT JOIN incidents i ON i.source_id=s.id AND i.is_synthetic=false
      WHERE s.sync_adapter='qamqor-arcgis-v1' AND s.data_mode='real'
      GROUP BY s.id ORDER BY s.id`),
  ]);
  return {
    records: result.rows.map((row) => ({ ...row, synthetic: false, dataMode: 'real' as const })),
    sources: sourceResult.rows,
  };
}

export async function listSources() {
  const result = await query(`SELECT s.*, (SELECT count(*)::int FROM incidents i WHERE i.source_id=s.id) AS incident_count
    FROM data_sources s ORDER BY s.created_at DESC`);
  return result.rows;
}

export async function listImportJobs(limit = 100) {
  const result = await query(`SELECT j.*, s.name AS source_name FROM import_jobs j JOIN data_sources s ON s.id=j.source_id
    ORDER BY j.created_at DESC LIMIT $1`, [Math.min(Math.max(limit, 1), 500)]);
  return result.rows;
}

export async function incidentCategories(eventType?: string) {
  const values: unknown[] = []; const typeFilter = eventType ? (values.push(eventType), 'AND i.event_type=$1') : '';
  const result = await query<{ category: string; count: number }>(`SELECT i.category AS category,count(*)::int AS count FROM incidents i JOIN data_sources s ON s.id=i.source_id WHERE s.data_mode='demo' ${typeFilter} GROUP BY i.category ORDER BY i.category`, values);
  return result.rows;
}

export type IncidentMapFilters = { from?: string; to?: string; eventType?: string; eventTypes?: string[]; category?: string; categoryType?: string; west?: number; south?: number; east?: number; north?: number; limit?: number; offset?: number; summaryOnly?: boolean };

function mapFilterSql(filters: IncidentMapFilters) {
  const values: unknown[] = []; const clauses = ["s.data_mode='real'", 'i.is_synthetic=false', "i.event_type IN ('crime','traffic_accident')", 'i.geom IS NOT NULL'];
  const add = (sql: (param: string) => string, value: unknown) => { values.push(value); clauses.push(sql(`$${values.length}`)); };
  if (filters.from) add((p) => `i.occurred_at >= ${p}::date`, filters.from);
  if (filters.to) add((p) => `i.occurred_at <= ${p}::date`, filters.to);
  if (filters.eventTypes !== undefined) add((p) => `i.event_type = ANY(${p}::text[])`, filters.eventTypes);
  else if (filters.eventType) add((p) => `i.event_type = ${p}`, filters.eventType);
  if (filters.category) add((p) => `i.category_code = ${p}`, filters.category);
  if (filters.categoryType) add((p) => `i.event_type = ${p}`, filters.categoryType);
  if (filters.west !== undefined && filters.south !== undefined && filters.east !== undefined && filters.north !== undefined) {
    values.push(filters.west, filters.south, filters.east, filters.north);
    clauses.push(`i.geom && ST_MakeEnvelope($${values.length - 3},$${values.length - 2},$${values.length - 1},$${values.length},4326)`);
  }
  return { where: clauses.join(' AND '), values };
}

export async function incidentMapData(filters: IncidentMapFilters = {}) {
  const { where, values } = mapFilterSql(filters);
  const categoryFilter = mapFilterSql({ ...filters, category: undefined, categoryType: undefined });
  const limit = Math.min(Math.max(filters.limit ?? 4000, 1), 10000), offset = Math.max(filters.offset ?? 0, 0);
  const [totals,cells,categories,sources] = await Promise.all([
    query(`SELECT count(*)::int AS total,min(i.occurred_at)::text AS from,max(i.occurred_at)::text AS to FROM incidents i JOIN data_sources s ON s.id=i.source_id WHERE ${where}`, values),
    filters.summaryOnly ? Promise.resolve({ rows: [] as QueryResultRow[] }) : query(`WITH grouped AS (
        SELECT i.event_type,i.category_code,
          floor(ST_X(i.geom)/0.005)::int AS gx,floor(ST_Y(i.geom)/0.005)::int AS gy,
          count(*)::int AS count,min(i.occurred_at)::text AS first_date,max(i.occurred_at)::text AS last_date
        FROM incidents i JOIN data_sources s ON s.id=i.source_id WHERE ${where}
        GROUP BY i.event_type,i.category_code,gx,gy
      ) SELECT event_type,category_code,count,
          (gx+0.5)*0.005 AS lon,(gy+0.5)*0.005 AS lat,first_date,last_date,'cell' AS record_level
        FROM grouped ORDER BY count DESC,event_type,category_code LIMIT $${values.length+1} OFFSET $${values.length+2}`,
    [...values,limit,offset]),
    query(`SELECT i.event_type,i.category_code,count(*)::int AS count
      FROM incidents i JOIN data_sources s ON s.id=i.source_id WHERE ${categoryFilter.where}
      GROUP BY i.event_type,i.category_code ORDER BY i.event_type,i.category_code`, categoryFilter.values),
    query(`SELECT s.id AS source_id,s.name,s.source_url,s.attribution,
        s.coverage_start::text AS coverage_start,s.coverage_end::text AS coverage_end,
        s.coverage_completeness,s.spatial_precision_m,s.retrieved_at::text AS retrieved_at,
        max(i.occurred_at)::text AS last_event_date,count(i.id)::int AS record_count,
        CASE WHEN s.id='qamqor-crime-astana-2026' THEN 'crime' ELSE 'traffic_accident' END AS event_type
      FROM data_sources s LEFT JOIN incidents i ON i.source_id=s.id AND i.is_synthetic=false
      WHERE s.sync_adapter='qamqor-arcgis-v1' AND s.data_mode='real'
      GROUP BY s.id ORDER BY s.id`),
  ]);
  return { total: Number(totals.rows[0]?.total ?? 0), period: { from: totals.rows[0]?.from ?? null, to: totals.rows[0]?.to ?? null }, items: cells.rows, categories: categories.rows, sources: sources.rows };
}

export async function incidentSummary(filters: { category?: string; from?: string; to?: string } = {}): Promise<{ total: number; from: string | null; to: string | null; last_import_at: Date | null; categories: Record<string, number> }> {
  const values: unknown[] = []; const clauses: string[] = ["s.data_mode='demo'"];
  for (const [field, column] of [['category', 'i.category'], ['from', 'i.occurred_at'], ['to', 'i.occurred_at']] as const) {
    const value = filters[field]; if (!value) continue; values.push(value); clauses.push(`${column} ${field === 'to' ? '<=' : field === 'from' ? '>=' : '='} $${values.length}${field === 'from' || field === 'to' ? '::date' : ''}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [totals, categories] = await Promise.all([
    query(`SELECT count(*)::int AS total,min(i.occurred_at)::text AS from,max(i.occurred_at)::text AS to,max(i.created_at) AS last_import_at FROM incidents i JOIN data_sources s ON s.id=i.source_id ${where}`, values),
    query(`SELECT i.category,count(*)::int AS count FROM incidents i JOIN data_sources s ON s.id=i.source_id ${where} GROUP BY i.category`, values),
  ]);
  const summary = totals.rows[0] as { total: number; from: string | null; to: string | null; last_import_at: Date | null };
  return { ...summary, categories: Object.fromEntries(categories.rows.map((row) => [String(row.category), Number(row.count)])) };
}

export async function incidentTimeSeries(category: string | undefined, interval: 'day' | 'week' | 'month') {
  const bucket = interval === 'month' ? "date_trunc('month', occurred_at)" : interval === 'week' ? "date_trunc('week', occurred_at)" : "date_trunc('day', occurred_at)";
  const label = interval === 'month' ? "to_char(period,'YYYY-MM')" : interval === 'week' ? "to_char(period,'IYYY-\"W\"IW')" : "to_char(period,'YYYY-MM-DD')";
  const values: unknown[] = []; const filter = category ? (values.push(category), 'AND i.category=$1') : '';
  const result = await query(`SELECT ${label} AS period,count(*)::int AS count FROM (SELECT ${bucket.replaceAll('occurred_at','i.occurred_at')} AS period,i.category FROM incidents i JOIN data_sources s ON s.id=i.source_id WHERE i.occurred_at IS NOT NULL AND s.data_mode='demo' ${filter}) events GROUP BY period ORDER BY period`, values);
  return result.rows;
}

export async function incidentHotspots(filters: IncidentMapFilters = {}) {
  return (await incidentMapData({ ...filters, limit: filters.limit ?? 4000 })).items;
}

export async function sourceSyncDue() {
  return query(`SELECT * FROM data_sources WHERE sync_enabled AND next_sync_at<=now() ORDER BY next_sync_at LIMIT 20`);
}

export function dbErrorResponse(error: unknown) {
  const unavailable = error instanceof DatabaseUnavailableError || (error instanceof Error && 'code' in error && ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(String((error as Error & { code?: string }).code)));
  return Response.json({ error: { code: unavailable ? 'DATABASE_UNAVAILABLE' : 'DATABASE_ERROR', message: unavailable ? 'Хранилище PostgreSQL пока недоступно.' : 'Не удалось выполнить запрос к базе данных.' } }, { status: unavailable ? 503 : 500 });
}
