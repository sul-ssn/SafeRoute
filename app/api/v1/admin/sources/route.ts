import { randomUUID, createHash } from 'node:crypto';
import { dbErrorResponse, listSources, query } from '@/db';

function allowed(request: Request) { return process.env.NODE_ENV !== 'production' || process.env.DEV_ADMIN_MODE === '1' || request.headers.get('x-admin-key') === process.env.ADMIN_API_KEY; }

export async function GET(request: Request) {
  if (!allowed(request)) return Response.json({ error: { code: 'FORBIDDEN', message: 'Доступ запрещён.' } }, { status: 403 });
  try { const items = await listSources(); return Response.json({ items, total: items.length }); }
  catch (error) { return dbErrorResponse(error); }
}

export async function POST(request: Request) {
  if (!allowed(request)) return Response.json({ error: { code: 'FORBIDDEN', message: 'Доступ запрещён.' } }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: { code: 'INVALID_JSON', message: 'Некорректный JSON.' } }, { status: 400 }); }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const sourceUrl = typeof body.source_url === 'string' ? body.source_url.trim() : '';
  const licenseNotes = typeof body.license_notes === 'string' ? body.license_notes.trim() : '';
  const dataMode = body.data_mode === 'real' || body.data_mode === 'aggregate' || body.data_mode === 'demo' ? body.data_mode : 'unverified';
  if (!name || name.length > 200) return Response.json({ error: { code: 'INVALID_SOURCE', message: 'Укажите название источника до 200 символов.' } }, { status: 400 });
  if (dataMode === 'real' && (!sourceUrl.startsWith('https://') || !licenseNotes || licenseNotes === 'Не подтверждено')) return Response.json({ error: { code: 'SOURCE_REVIEW_REQUIRED', message: 'Для режима REAL укажите HTTPS-источник и подтверждённые условия использования.' } }, { status: 400 });
  const id = randomUUID(), key = createHash('sha256').update(`${name.toLowerCase()}|${sourceUrl}`).digest('hex');
  try {
    const result = await query(`INSERT INTO data_sources(id,source_key,name,description,source_url,license_notes,data_mode,coverage_start,coverage_end,coverage_completeness,spatial_precision_m)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11) ON CONFLICT(source_key) DO UPDATE SET description=EXCLUDED.description,license_notes=EXCLUDED.license_notes,data_mode=EXCLUDED.data_mode,updated_at=now()
      RETURNING *`, [id, key, name, String(body.description ?? '').slice(0, 2000) || null, sourceUrl || null, licenseNotes || 'Не подтверждено', dataMode,
      body.coverage_start ?? null, body.coverage_end ?? null, body.coverage_completeness ?? null, body.spatial_precision_m ?? null]);
    return Response.json({ item: result.rows[0] }, { status: 201 });
  } catch (error) { return dbErrorResponse(error); }
}
