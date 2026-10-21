import { getRiskRecords } from '@/db';
import { assessRouteExposure, compareRouteExposures } from '@/risk';
import { buildRoutes } from '@/routing';
import { routeRequestSchema } from '@/validation';
import { canRankByRiskExposure, classifyRouteRiskData, loadOptionalRouteRisk, MAX_RISK_SOURCE_AGE_DAYS } from '@/risk-data-logic.mjs';

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: { code: 'INVALID_JSON', message: 'Некорректный JSON в запросе.' } }, { status: 400 }); }
  const parsed = routeRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: { code: 'INVALID_REQUEST', message: 'Проверьте координаты и параметры маршрута.', details: parsed.error.flatten().fieldErrors } }, { status: 400 });

  try {
    const { origin, destination, preference, profile } = parsed.data;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
    const period = { from: parsed.data.from ?? '2026-01-01', to: parsed.data.to ?? today };
    const routes = await buildRoutes(origin, destination, profile, preference);
    const assessments = await Promise.all(routes.map((route) => loadOptionalRouteRisk(route, async (currentRoute: typeof route) => {
        const data = await getRiskRecords(currentRoute.geometry, period);
        const risk = assessRouteExposure(currentRoute.geometry, data.records, data.sources, period);
        const dataStatus = classifyRouteRiskData({ sources: data.sources, records: data.records, riskConfidence: risk.confidence });
        return { risk, ...dataStatus };
      }, (unavailableRoute: typeof route) => ({ risk: assessRouteExposure(unavailableRoute.geometry, [], [], period), status: 'unavailable' as const, sourceAgeDays: null, maxAgeDays: MAX_RISK_SOURCE_AGE_DAYS, staleReason: null }))));
    const comparedRisk = compareRouteExposures(assessments.map((item) => item.risk));
    const withRisk = routes.map((route, index) => {
      const risk = comparedRisk[index];
      return {
        ...route,
        risk_data_status: assessments[index].status,
        risk_data_age_days: assessments[index].sourceAgeDays,
        risk_data_max_age_days: assessments[index].maxAgeDays,
        risk_data_stale_reason: assessments[index].staleReason,
        snapped_origin: { lon: route.geometry.coordinates[0][0], lat: route.geometry.coordinates[0][1] },
        snapped_destination: { lon: route.geometry.coordinates.at(-1)![0], lat: route.geometry.coordinates.at(-1)![1] },
        risk_score: risk.score,
        risk_confidence: risk.confidence,
        risk_model_version: risk.version,
        risk_explanation: risk.explanation,
        nearby_events: risk.nearby_events,
        crime_events: risk.crime_events,
        traffic_accident_events: risk.traffic_accident_events,
        crime_exposure: risk.crime_exposure,
        traffic_accident_exposure: risk.traffic_accident_exposure,
        crime_exposure_per_km: risk.crime_exposure_per_km,
        traffic_accident_exposure_per_km: risk.traffic_accident_exposure_per_km,
        risk_coverage: risk.coverage,
        risk_category_counts: risk.category_counts,
      };
    });
    const riskCanRank = canRankByRiskExposure(assessments.map(({ status, sourceAgeDays, risk }) => ({ status, sourceAgeDays, confidence: risk.confidence })));
    const riskRankingApplied = preference === 'less_events' && riskCanRank && withRisk.length > 1;
    if (riskRankingApplied) withRisk.sort((a, b) => (a.crime_exposure_per_km + a.traffic_accident_exposure_per_km) - (b.crime_exposure_per_km + b.traffic_accident_exposure_per_km));
    return Response.json({
      routes: withRisk, provider: 'valhalla', data_mode: 'osm', profile, risk_ranking_applied: riskRankingApplied,
      risk_period: period,
      snapped_locations: 'Valhalla привязывает исходные координаты к ближайшим доступным рёбрам графа OSM для выбранного транспорта.',
      duration_notice: 'Время — расчёт Valhalla по геометрии и атрибутам дорожного графа для выбранного профиля; актуальные пробки и задержки не учитываются.',
      data_notice: 'Индекс основан на публичных записях Qamqor за ограниченный период. Полнота статистики и точность координат источником не опубликованы; отсутствие записей не означает безопасность. Индекс относительный и не является вероятностью происшествия.',
    });
  } catch (error) {
    const failure = error as Error & { code?: string; status?: number };
    return Response.json({ error: { code: failure.code ?? 'ROUTE_UNAVAILABLE', message: failure.message || 'Не удалось построить маршрут.' } }, { status: failure.status ?? 503 });
  }
}
