import { dbErrorResponse, query } from '@/db';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production' && process.env.DEV_ADMIN_MODE !== '1' && request.headers.get('x-admin-key') !== process.env.ADMIN_API_KEY) return Response.json({ error: { code: 'FORBIDDEN', message: 'Доступ запрещён.' } }, { status: 403 });
  try { const { id } = await params; const result = await query('SELECT j.*,s.name AS source_name FROM import_jobs j JOIN data_sources s ON s.id=j.source_id WHERE j.id=$1', [id]); if (!result.rowCount) return Response.json({ error: { code: 'NOT_FOUND', message: 'Задание импорта не найдено.' } }, { status: 404 }); return Response.json(result.rows[0]); }
  catch (error) { return dbErrorResponse(error); }
}
