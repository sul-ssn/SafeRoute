import { dbErrorResponse, query } from '@/db';
type Context = { params: Promise<{ id: string }> };
function allowed(request: Request) { return process.env.NODE_ENV !== 'production' || process.env.DEV_ADMIN_MODE === '1' || request.headers.get('x-admin-key') === process.env.ADMIN_API_KEY; }

export async function GET(request: Request, context: Context) {
  if (!allowed(request)) return Response.json({ error: { code: 'FORBIDDEN', message: 'Доступ запрещён.' } }, { status: 403 });
  try { const { id } = await context.params; const result = await query('SELECT * FROM data_sources WHERE id=$1', [id]); if (!result.rowCount) return Response.json({ error: { code: 'NOT_FOUND', message: 'Источник не найден.' } }, { status: 404 }); return Response.json({ item: result.rows[0] }); }
  catch (error) { return dbErrorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  if (!allowed(request)) return Response.json({ error: { code: 'FORBIDDEN', message: 'Доступ запрещён.' } }, { status: 403 });
  let body: Record<string, unknown>; try { body = await request.json(); } catch { return Response.json({ error: { code: 'INVALID_JSON', message: 'Некорректный JSON.' } }, { status: 400 }); }
  const { id } = await context.params;
  let previous: Record<string, unknown>;
  try { const current = await query('SELECT * FROM data_sources WHERE id=$1', [id]); if (!current.rowCount) return Response.json({ error: { code: 'NOT_FOUND', message: 'Источник не найден.' } }, { status: 404 }); previous = current.rows[0]; }
  catch (error) { return dbErrorResponse(error); }
  const mode = body.data_mode === undefined ? previous.data_mode : body.data_mode;
  const url = body.source_url === undefined ? previous.source_url : body.source_url;
  const license = body.license_notes === undefined ? previous.license_notes : body.license_notes;
  if (!['demo', 'real', 'aggregate', 'unverified'].includes(String(mode))) return Response.json({ error: { code: 'INVALID_SOURCE', message: 'Недопустимый режим данных.' } }, { status: 400 });
  if (previous.data_mode === 'demo' && mode === 'real') return Response.json({ error: { code: 'SYNTHETIC_SOURCE_IMMUTABLE', message: 'DEMO-источник нельзя перевести в REAL. Зарегистрируйте отдельный подтверждённый источник.' } }, { status: 400 });
  if (mode === 'real' && (typeof url !== 'string' || !url.startsWith('https://') || typeof license !== 'string' || !license.trim() || license === 'Не подтверждено')) return Response.json({ error: { code: 'SOURCE_REVIEW_REQUIRED', message: 'Для режима REAL укажите HTTPS-источник и подтверждённые условия использования.' } }, { status: 400 });
  const syncEnabled = body.sync_enabled === undefined ? previous.sync_enabled : body.sync_enabled === true;
  const syncAdapter = body.sync_adapter === undefined ? previous.sync_adapter : body.sync_adapter;
  const syncUrl = body.sync_url === undefined ? previous.sync_url : body.sync_url;
  const interval = body.sync_interval_minutes === undefined ? Number(previous.sync_interval_minutes) : Number(body.sync_interval_minutes);
  const syncFileFormat = body.sync_file_format === undefined ? previous.sync_file_format : body.sync_file_format;
  if (syncEnabled && (mode !== 'real' || syncAdapter !== 'https-file-v1' || typeof syncUrl !== 'string' || !syncUrl.startsWith('https://') || !['csv', 'geojson'].includes(String(syncFileFormat)) || !Number.isInteger(interval) || interval < 15)) return Response.json({ error: { code: 'SYNC_CONFIGURATION_REQUIRED', message: 'Для расписания нужны REAL-источник, HTTPS URL, адаптер https-file-v1, формат CSV/GeoJSON и интервал не короче 15 минут.' } }, { status: 400 });
  try {
    const result = await query(`UPDATE data_sources SET data_mode=$2,source_url=$3,license_notes=$4,description=$5,
      coverage_start=$6::date,coverage_end=$7::date,coverage_completeness=$8,spatial_precision_m=$9,
      sync_enabled=$10,sync_adapter=$11,sync_url=$12,sync_interval_minutes=$13,sync_file_format=$14,
      next_sync_at=CASE WHEN $10 THEN COALESCE(next_sync_at,now()) ELSE NULL END,updated_at=now()
      WHERE id=$1 RETURNING *`, [id, mode, url, license, body.description ?? previous.description,
      body.coverage_start ?? previous.coverage_start, body.coverage_end ?? previous.coverage_end,
      body.coverage_completeness ?? previous.coverage_completeness, body.spatial_precision_m ?? previous.spatial_precision_m,
      syncEnabled, syncAdapter, syncUrl, interval, syncFileFormat]);
    return Response.json({ item: result.rows[0] });
  } catch (error) { return dbErrorResponse(error); }
}
