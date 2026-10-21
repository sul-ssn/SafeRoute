import { dbErrorResponse, incidentMapData } from '@/db';
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
    const from = params.get('from') ?? '2026-01-01';
    const to = params.get('to') ?? today;
    const eventTypes = (params.get('event_type') ?? 'crime,traffic_accident').split(',').filter(Boolean);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to || eventTypes.some((type) => type !== 'crime' && type !== 'traffic_accident')) return Response.json({ error: { code: 'INVALID_FILTER', message: 'Проверьте период и выбранные источники.' } }, { status: 400 });
    const categoryParam = params.get('category') || undefined;
    const [categoryType,category] = categoryParam?.includes(':') ? [categoryParam.split(':')[0],categoryParam.split(':').slice(1).join(':')] : [undefined,categoryParam];
    const { items } = await incidentMapData({ from, to, eventTypes, category, categoryType, limit: 10000 });
    const header = 'event_type,category_code,count,cell_lat,cell_lon,first_date,last_date,source_attribution';
    const rows = items.map((item) => [item.event_type, item.category_code, item.count, Number(item.lat).toFixed(3), Number(item.lon).toFixed(3), item.first_date, item.last_date, 'Информация получена с официального интернет-портала qamqor.gov.kz'].map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','));
    return new Response([header, ...rows].join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="saferoute-qamqor-aggregates.csv"', 'Cache-Control': 'no-store' } });
  } catch (error) { return dbErrorResponse(error); }
}
