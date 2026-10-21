import { dbErrorResponse, incidentTimeSeries } from '@/db';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams; const interval = params.get('interval') ?? 'month';
  if (!['day', 'week', 'month'].includes(interval)) return Response.json({ error: { code: 'INVALID_INTERVAL', message: 'Допустимые интервалы: day, week, month.' } }, { status: 400 });
  try { return Response.json({ items: await incidentTimeSeries(params.get('category') ?? undefined, interval as 'day' | 'week' | 'month'), data_mode: 'mixed' }); }
  catch (error) { return dbErrorResponse(error); }
}
