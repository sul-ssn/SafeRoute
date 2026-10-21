import { dbErrorResponse, incidentMapData } from '@/db';
import { querySchema } from '@/validation';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse(Object.fromEntries(params.entries()));
  if (!parsed.success) return Response.json({ error: { code: 'INVALID_QUERY', message: 'Проверьте параметры фильтрации.', details: parsed.error.flatten().fieldErrors } }, { status: 400 });
  const { from, to, category, page, page_size } = parsed.data;
  const rawTypes = params.get('event_type');
  const eventTypes = rawTypes ? rawTypes.split(',') : undefined;
  if (eventTypes?.some((type) => type !== 'crime' && type !== 'traffic_accident')) return Response.json({ error: { code: 'INVALID_EVENT_TYPE', message: 'Допустимы типы crime и traffic_accident.' } }, { status: 400 });
  let bbox: number[] | undefined;
  if (params.has('bbox')) {
    bbox = (params.get('bbox') ?? '').split(',').map(Number);
    if (bbox.length !== 4 || bbox.some((number) => !Number.isFinite(number)) || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90 || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
      return Response.json({ error: { code: 'INVALID_BBOX', message: 'bbox должен иметь формат west,south,east,north.' } }, { status: 400 });
    }
  }
  try {
    const result = await incidentMapData({ west: bbox?.[0], south: bbox?.[1], east: bbox?.[2], north: bbox?.[3], from, to, category, eventTypes, limit: page_size, offset: (page - 1) * page_size });
    return Response.json({ items: result.items, total: result.total, page, page_size, data_mode: 'real', bbox: bbox ?? null, attribution: 'Информация получена с официального интернет-портала qamqor.gov.kz', aggregation: 'Точки сгруппированы в ячейки около 350–550 м; точные координаты и идентификаторы не выдаются.' });
  } catch (error) { return dbErrorResponse(error); }
}
