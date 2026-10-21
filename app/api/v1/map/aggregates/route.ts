import { dbErrorResponse, incidentMapData } from '@/db';
import { incidentPeriodRange, type IncidentPeriodPreset } from '@/periods';

function astanaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
}


export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const today = astanaToday();
  const period = params.get('period') ?? 'all';
  if (!['7d','30d','90d','all'].includes(period)) return Response.json({ error: { code: 'INVALID_PERIOD', message: 'Период должен быть 7d, 30d, 90d или all.' } }, { status: 400 });
  const defaults = incidentPeriodRange(period as IncidentPeriodPreset, today);
  const from = params.get('from') ?? defaults.from;
  const to = params.get('to') ?? defaults.to;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return Response.json({ error: { code: 'INVALID_DATE_RANGE', message: 'Проверьте диапазон дат.' } }, { status: 400 });
  const requestedTypes = (params.get('event_type') ?? 'crime,traffic_accident').split(',').filter(Boolean);
  if (requestedTypes.some((type) => type !== 'crime' && type !== 'traffic_accident')) return Response.json({ error: { code: 'INVALID_EVENT_TYPE', message: 'Допустимы типы crime и traffic_accident.' } }, { status: 400 });
  const categoryParam = params.get('category') || undefined;
  const categoryParts = categoryParam?.split(':') ?? [];
  const [categoryType,category] = categoryParts.length > 1 ? [categoryParts[0],categoryParts.slice(1).join(':')] : [undefined,categoryParam];
  if (categoryType && !requestedTypes.includes(categoryType)) return Response.json({ error: { code: 'INVALID_CATEGORY', message: 'Категория не соответствует выбранному слою.' } }, { status: 400 });
  const bbox = params.get('bbox')?.split(',').map(Number);
  if (bbox && (bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value)) || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90 || bbox[0] >= bbox[2] || bbox[1] >= bbox[3])) return Response.json({ error: { code: 'INVALID_BBOX', message: 'bbox должен иметь формат west,south,east,north.' } }, { status: 400 });
  try {
    const result = await incidentMapData({
      from, to, eventTypes: requestedTypes, category, categoryType,
      west: bbox?.[0], south: bbox?.[1], east: bbox?.[2], north: bbox?.[3], limit: 10000,
      summaryOnly: params.get('summary_only') === 'true',
    });
    const relevantSources = result.sources.filter((source) => requestedTypes.includes(String(source.event_type)));
    return Response.json({
      items: result.items,
      total: result.total,
      aggregate_count: result.items.length,
      categories: result.categories.filter((item) => requestedTypes.includes(String(item.event_type))),
      sources: relevantSources,
      period: { preset: period, from, to, available_from: result.period.from, available_to: result.period.to },
      aggregation: { type: 'grid-cell', resolution_degrees: 0.005, disclosure: 'Точные координаты происшествий не отдаются; точки собраны в ячейки около 350–550 м.' },
      attribution: 'Информация получена с официального интернет-портала qamqor.gov.kz',
      data_mode: 'real',
    });
  } catch (error) { return dbErrorResponse(error); }
}
