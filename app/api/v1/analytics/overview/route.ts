import { dbErrorResponse, incidentSummary, incidentTimeSeries } from '@/db';
const labels = new Map([['01','Янв'],['02','Фев'],['03','Мар'],['04','Апр'],['05','Май'],['06','Июн'],['07','Июл'],['08','Авг'],['09','Сен'],['10','Окт'],['11','Ноя'],['12','Дек']]);
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams; const category = params.get('category');
  try {
    const filters = { category: category && category !== 'Все категории' ? category : undefined, from: params.get('from') ?? undefined, to: params.get('to') ?? undefined };
    const [summary, series] = await Promise.all([incidentSummary(filters), incidentTimeSeries(filters.category, 'month')]);
    return Response.json({ total: summary.total, categories: summary.categories, period: { from: summary.from, to: summary.to }, weekly: series.map((item) => ({ label: labels.get(String(item.period).slice(5, 7)) ?? String(item.period), count: item.count })), source: 'SafeRoute DEMO', dataMode: 'demo', lastImportAt: summary.last_import_at, notice: 'Эта сводка показывает только синтетический набор; реальные записи Qamqor доступны на карте и в оценке маршрутов.' });
  } catch (error) { return dbErrorResponse(error); }
}
