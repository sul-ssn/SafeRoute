import { dbErrorResponse, listImportJobs } from '@/db';
import { maxUploadBytes, persistImport } from '@/imports';

function allowed(request: Request) { return process.env.NODE_ENV !== 'production' || process.env.DEV_ADMIN_MODE === '1' || request.headers.get('x-admin-key') === process.env.ADMIN_API_KEY; }

export async function GET(request: Request) {
  if (!allowed(request)) return Response.json({ error: { code: 'FORBIDDEN', message: 'История доступна только администратору.' } }, { status: 403 });
  try { const items = await listImportJobs(); return Response.json({ items, total: items.length }); }
  catch (error) { return dbErrorResponse(error); }
}

export async function POST(request: Request) {
  if (!allowed(request)) return Response.json({ error: { code: 'FORBIDDEN', message: 'Импорт доступен только администратору.' } }, { status: 403 });
  const form = await request.formData().catch(() => null); const file = form?.get('file');
  if (!(file instanceof File)) return Response.json({ error: { code: 'FILE_REQUIRED', message: 'Выберите файл CSV или GeoJSON.' } }, { status: 400 });
  if (file.size > maxUploadBytes) return Response.json({ error: { code: 'FILE_TOO_LARGE', message: 'Размер файла превышает 2 МБ.' } }, { status: 413 });
  try {
    const result = await persistImport(file.name, Buffer.from(await file.arrayBuffer()), {
      sourceId: String(form?.get('source_id') ?? '').trim() || undefined,
      name: String(form?.get('source_name') ?? '').trim() || file.name,
      url: String(form?.get('source_url') ?? '').trim() || undefined,
      licenseNotes: String(form?.get('license_notes') ?? '').trim() || undefined,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Источник не найден')) return Response.json({ error: { code: 'SOURCE_NOT_FOUND', message: error.message } }, { status: 400 });
    if (error instanceof Error && /CSV|GeoJSON|поле|координат|категор|формат|лимит|к кавычк|заголов|DEMO-источник/.test(error.message)) return Response.json({ error: { code: 'INVALID_FILE', message: error.message } }, { status: 400 });
    return dbErrorResponse(error);
  }
}
