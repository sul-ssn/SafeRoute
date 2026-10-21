import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { inTransaction } from './db.ts';

export const maxUploadBytes = 16 * 1024 * 1024;
const blockedFields = /^(?:name|full_name|person_name|victim_name|phone|phone_number|address|street|home_number|child|minor|person|фио|имя|фамилия|телефон|адрес|улица|дом|потерпевший|несовершеннолетний|ud|case_id|caseid|criminal_case|уголовное_дело|victim_id|person_id)$/i;
export type SafeRow = { eventType: 'crime' | 'traffic_accident' | 'other'; category: string; categoryCode: string; classificationCode: string; sourceAttribution: string; date: string; lat: number; lon: number; accuracyM: number | null; externalId: string };
export type ImportSource = { sourceId?: string; name?: string; url?: string; licenseNotes?: string; attribution?: string };

function contentRecordHash(row: SafeRow, occurrence: number) {
  const id = row.externalId.trim();
  const fields = id ? [`id:${Buffer.byteLength(id)}`, id] : [
    `type:${Buffer.byteLength(row.eventType)}`, row.eventType,
    `category:${Buffer.byteLength(row.categoryCode)}`, row.categoryCode,
    `classification:${Buffer.byteLength(row.classificationCode)}`, row.classificationCode,
    row.date, row.lat.toFixed(6), row.lon.toFixed(6), `occurrence:${occurrence}`,
  ];
  return createHash('sha256').update(fields.join('|')).digest('hex');
}

/** Stable multiset identity: preserve indistinguishable source rows, while making a repeated import idempotent. */
export function contentRecordHashes(rows: SafeRow[]) {
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const id = row.externalId.trim();
    const identity = id ? `id:${Buffer.byteLength(id)}|${id}` : JSON.stringify([
      row.eventType, row.categoryCode, row.classificationCode, row.date, row.lat.toFixed(6), row.lon.toFixed(6),
    ]);
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    return contentRecordHash(row, occurrence);
  });
}

function csvRecords(text: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('CSV должен содержать заголовок и минимум одну строку.');
  const parse = (line: string) => {
    const result: string[] = []; let field = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"' && quoted) { field += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { result.push(field); field = ''; }
      else field += char;
    }
    if (quoted) throw new Error('CSV содержит незакрытую кавычку.');
    result.push(field); return result;
  };
  const headers = parse(lines[0]).map((value) => value.trim().toLowerCase());
  if (headers.length > 100 || new Set(headers).size !== headers.length) throw new Error('Некорректные или повторяющиеся заголовки CSV.');
  return lines.slice(1).map((line) => Object.fromEntries(parse(line).map((value, index) => [headers[index], value])));
}

function rawRecords(filename: string, buffer: Buffer): Record<string, unknown>[] {
  const text = buffer.toString('utf8');
  if (filename.toLowerCase().endsWith('.csv')) return csvRecords(text);
  if (!filename.toLowerCase().endsWith('.geojson') && !filename.toLowerCase().endsWith('.json')) throw new Error('Поддерживаются только CSV и GeoJSON.');
  let input: unknown; try { input = JSON.parse(text); } catch { throw new Error('Некорректный JSON/GeoJSON.'); }
  if (!input || typeof input !== 'object' || (input as { type?: string }).type !== 'FeatureCollection' || !Array.isArray((input as { features?: unknown[] }).features)) throw new Error('GeoJSON должен быть FeatureCollection.');
  const features = (input as { features: unknown[] }).features;
  if (features.length > 25000) throw new Error('Превышен лимит 25 000 объектов.');
  return features.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Некорректный Feature.');
    const feature = value as { type?: string; geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> };
    if (feature.type !== 'Feature' || !feature.geometry || feature.geometry.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) throw new Error('Для импорта разрешена только Point geometry.');
    const [lon, lat] = feature.geometry.coordinates;
    if (typeof lat !== 'number' || typeof lon !== 'number') throw new Error('Некорректные координаты GeoJSON.');
    return { ...(feature.properties ?? {}), lon, lat };
  });
}

function normalize(record: Record<string, unknown>): SafeRow {
  const keys = Object.keys(record).map((key) => key.toLowerCase());
  if (keys.some((key) => blockedFields.test(key))) throw new Error('Обнаружено запрещённое поле.');
  const pick = (...names: string[]) => {
    for (const name of names) { const key = Object.keys(record).find((item) => item.toLowerCase() === name); if (key !== undefined) return record[key]; }
    return undefined;
  };
  const eventValue = String(pick('event_type') ?? 'other').trim();
  if (!['crime','traffic_accident','other'].includes(eventValue)) throw new Error('Неизвестный тип события.');
  const categoryCode = String(pick('category_code', 'category') ?? '').trim();
  if (!categoryCode || categoryCode.length > 120) throw new Error('Укажите код категории (не более 120 символов).');
  const category = String(pick('category') ?? categoryCode).trim();
  if (!category || category.length > 120) throw new Error('Категория слишком длинная.');
  const classificationCode = String(pick('classification_code') ?? '').trim().slice(0, 120);
  const sourceAttribution = String(pick('source_attribution') ?? '').trim().slice(0, 500);
  const rawDate = pick('occurred_at', 'occurred_on', 'date'); const date = rawDate === undefined || rawDate === '' ? '' : String(rawDate).slice(0, 10);
  const timestamp = date ? Date.parse(`${date}T00:00:00.000Z`) : 0;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date)) throw new Error('Дата должна быть корректной датой в формате YYYY-MM-DD.');
  const rawLat = pick('lat', 'latitude'), rawLon = pick('lon', 'lng', 'longitude');
  if (rawLat === undefined || rawLat === '' || rawLon === undefined || rawLon === '') throw new Error('Для записи нужны обе координаты.');
  const lat = Number(rawLat), lon = Number(rawLon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('Координаты за пределами допустимого диапазона.');
  const rawAccuracy = pick('accuracy_m', 'spatial_precision_m'); const accuracyM = rawAccuracy === undefined || rawAccuracy === '' ? null : Number(rawAccuracy);
  if (accuracyM !== null && (!Number.isFinite(accuracyM) || accuracyM < 0 || accuracyM > 100000)) throw new Error('Некорректная точность координат.');
  const externalId = String(pick('external_id', 'id') ?? '').trim();
  if (externalId.length > 200) throw new Error('Внешний ID слишком длинный.');
  return { eventType: eventValue as SafeRow['eventType'], category, categoryCode, classificationCode, sourceAttribution, date, lat, lon, accuracyM, externalId };
}

export function validateImport(filename: string, buffer: Buffer) {
  if (buffer.length > maxUploadBytes) throw new Error('Размер файла превышает 16 МБ.');
  const raw = rawRecords(filename, buffer); const errors: string[] = []; const valid: SafeRow[] = [];
  raw.forEach((record, index) => { try { valid.push(normalize(record)); } catch (error) { errors.push(`Строка ${index + 2}: ${error instanceof Error ? error.message : 'некорректные данные'}`); } });
  return {
    rows: valid, totalRows: raw.length, rejectedRows: errors.length, errors: errors.slice(0, 20),
    preview: valid.slice(0, 10).map((row) => ({ event_type: row.eventType, category_code: row.categoryCode, occurred_at: row.date || null, lat: Number(row.lat.toFixed(5)), lon: Number(row.lon.toFixed(5)), record_level: row.accuracyM === null || row.accuracyM <= 100 ? 'point' : 'cell' })),
  };
}

async function findOrCreateSource(client: PoolClient, source: ImportSource, rows: SafeRow[]) {
  if (source.sourceId) {
    const existing = await client.query('SELECT id,data_mode FROM data_sources WHERE id=$1', [source.sourceId]);
    if (!existing.rowCount) throw new Error('Источник не найден. Сначала зарегистрируйте его.');
    if (existing.rows[0].data_mode === 'demo') throw new Error('Нельзя импортировать реальные файлы в DEMO-источник. Создайте отдельный источник.');
    return source.sourceId;
  }
  const name = source.name?.trim() || 'Импортированный набор';
  const url = source.url?.trim() || null;
  const license = source.licenseNotes?.trim() || 'Не подтверждено';
  const sourceKey = createHash('sha256').update(`${name.toLowerCase()}|${url ?? ''}`).digest('hex');
  const dates = rows.map((row) => row.date).filter(Boolean).sort();
  const id = randomUUID();
  const result = await client.query(`INSERT INTO data_sources(id,source_key,name,source_url,license_notes,attribution,data_mode,coverage_start,coverage_end,retrieved_at,last_import_at)
      VALUES($1,$2,$3,$4,$5,$6,'unverified',$7::date,$8::date,now(),now())
      ON CONFLICT(source_key) DO UPDATE SET last_import_at=now(),retrieved_at=now(),updated_at=now(),
        coverage_start=COALESCE(data_sources.coverage_start,EXCLUDED.coverage_start),coverage_end=COALESCE(EXCLUDED.coverage_end,data_sources.coverage_end)
      RETURNING id`, [id, sourceKey, name, url, license, source.attribution ?? null, dates[0] ?? null, dates.at(-1) ?? null]);
  return result.rows[0].id as string;
}

export async function persistImport(filename: string, buffer: Buffer, source: ImportSource = {}) {
  const report = validateImport(filename, buffer);
  const checksum = createHash('sha256').update(buffer).digest('hex');
  const recordHashes = contentRecordHashes(report.rows);
  return inTransaction(async (client) => {
    const sourceId = await findOrCreateSource(client, source, report.rows);
    const result = report.rows.length ? await client.query(`INSERT INTO incidents(source_id,external_id,record_hash,event_type,category,category_code,classification_code,source_attribution,occurred_at,geom,spatial_precision_m)
      SELECT $1,external_id,record_hash,event_type,category,category_code,classification_code,source_attribution,occurred_at::date,ST_SetSRID(ST_MakePoint(lon,lat),4326),accuracy_m
      FROM unnest($2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::date[],$10::float8[],$11::float8[],$12::numeric[])
        AS rows(external_id,record_hash,event_type,category,category_code,classification_code,source_attribution,occurred_at,lon,lat,accuracy_m)
      ON CONFLICT DO NOTHING RETURNING id`, [sourceId,
      report.rows.map((row) => row.externalId || null),
      recordHashes,
      report.rows.map((row) => row.eventType), report.rows.map((row) => row.category), report.rows.map((row) => row.categoryCode),
      report.rows.map((row) => row.classificationCode || null), report.rows.map((row) => row.sourceAttribution || null),
      report.rows.map((row) => row.date || null), report.rows.map((row) => row.lon), report.rows.map((row) => row.lat), report.rows.map((row) => row.accuracyM)]
    ) : { rowCount: 0 };
    const inserted = result.rowCount ?? 0, duplicateRows = report.rows.length - inserted;
    const dates = report.rows.map((row) => row.date).filter(Boolean).sort();
    await client.query(`UPDATE data_sources SET last_import_at=now(),retrieved_at=now(),updated_at=now(),
      coverage_start=LEAST(coverage_start, $2::date), coverage_end=GREATEST(coverage_end, $3::date)
      WHERE id=$1`, [sourceId, dates[0] ?? null, dates.at(-1) ?? null]);
    const status = report.rejectedRows ? 'completed_with_errors' : 'completed';
    const jobResult = await client.query(`INSERT INTO import_jobs(source_id,filename,checksum,status,total_rows,accepted_rows,rejected_rows,duplicate_rows,period_start,period_end,errors)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11::jsonb) RETURNING *`,
    [sourceId, filename, checksum, status, report.totalRows, inserted, report.rejectedRows, duplicateRows, dates[0] ?? null, dates.at(-1) ?? null, JSON.stringify(report.errors)]);
    return { job: { ...jobResult.rows[0], source_name: source.name || filename }, errors: report.errors, source_id: sourceId };
  });
}
