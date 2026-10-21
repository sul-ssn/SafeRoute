import { geometryLengthMeters, type GeoJsonLineString } from './routing.ts';

export const RISK_MODEL_VERSION = 'route-exposure-v3-qamqor';
export const RISK_SEARCH_RADIUS_M = 150;
const FRESHNESS_HALF_LIFE_DAYS = 365;
const MIN_ROUTE_EVENTS = 5;

export type RiskEvent = {
  event_type: 'crime' | 'traffic_accident';
  category: string;
  category_code: string;
  classification_code: string | null;
  occurredAt: string;
  lat: number;
  lon: number;
  precision_m: number | null;
  source_precision_m: number | null;
  source_id: string;
  source_name: string;
  synthetic: boolean;
  dataMode: 'demo' | 'real' | 'aggregate' | 'unverified';
};

export type RiskSource = {
  id: string;
  name: string;
  source_url: string;
  attribution: string;
  coverage_start: string | null;
  coverage_end: string | null;
  coverage_completeness: number | null;
  spatial_precision_m: number | null;
  retrieved_at: string | Date | null;
  last_event_date: string | null;
  record_count: number;
  event_type: 'crime' | 'traffic_accident';
};

export type RiskPeriod = { from: string; to: string };
export type RouteExposure = {
  score: number | null;
  confidence: 'insufficient_data' | 'limited';
  version: string;
  explanation: string;
  nearby_events: number;
  crime_events: number;
  traffic_accident_events: number;
  crime_exposure: number;
  traffic_accident_exposure: number;
  crime_exposure_per_km: number;
  traffic_accident_exposure_per_km: number;
  category_counts: Record<string, Record<string, number>>;
  coverage: Array<{
    event_type: 'crime' | 'traffic_accident';
    source_name: string;
    coverage_start: string | null;
    last_event_date: string | null;
    temporal_coverage_percent: number;
    statistical_completeness_percent: number | null;
    coordinate_accuracy_m: number | null;
  }>;
};

function pointSegmentDistanceMeters(lon: number, lat: number, a: [number, number], b: [number, number]) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * Math.cos(lat * Math.PI / 180);
  const px = (lon - a[0]) * metersPerDegreeLon, py = (lat - a[1]) * metersPerDegreeLat;
  const bx = (b[0] - a[0]) * metersPerDegreeLon, by = (b[1] - a[1]) * metersPerDegreeLat;
  const denominator = bx * bx + by * by;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / denominator));
  return Math.hypot(px - t * bx, py - t * by);
}

function distanceToRoute(record: RiskEvent, geometry: GeoJsonLineString) {
  let closest = Infinity;
  for (let i = 1; i < geometry.coordinates.length; i++) {
    closest = Math.min(closest, pointSegmentDistanceMeters(record.lon, record.lat, geometry.coordinates[i - 1], geometry.coordinates[i]));
  }
  return closest;
}

function daysBetween(from: string, to: string) {
  return Math.max(1, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1);
}

function periodCoverage(source: RiskSource | undefined, period: RiskPeriod) {
  if (!source?.coverage_start || !source.last_event_date) return 0;
  const left = source.coverage_start > period.from ? source.coverage_start : period.from;
  const right = source.last_event_date < period.to ? source.last_event_date : period.to;
  if (right < left) return 0;
  return Math.min(100, Math.round(daysBetween(left, right) / daysBetween(period.from, period.to) * 100));
}

export function assessRouteExposure(geometry: GeoJsonLineString, records: RiskEvent[], sources: RiskSource[], period: RiskPeriod): RouteExposure {
  const sourceByType = new Map(sources.map((source) => [source.event_type, source]));
  const coverage = (['crime', 'traffic_accident'] as const).map((eventType) => {
    const source = sourceByType.get(eventType);
    return {
      event_type: eventType,
      source_name: source?.name ?? (eventType === 'crime' ? 'Qamqor GIS — преступления' : 'Qamqor GIS — ДТП'),
      coverage_start: source?.coverage_start ?? null,
      last_event_date: source?.last_event_date ?? null,
      temporal_coverage_percent: periodCoverage(source, period),
      statistical_completeness_percent: source?.coverage_completeness == null ? null : Math.round(Number(source.coverage_completeness) * 100),
      coordinate_accuracy_m: source?.spatial_precision_m == null ? null : Number(source.spatial_precision_m),
    };
  });

  const valid = records.filter((record) => !record.synthetic && record.dataMode === 'real' &&
    (record.event_type === 'crime' || record.event_type === 'traffic_accident') &&
    record.occurredAt >= period.from && record.occurredAt <= period.to &&
    /^\d{4}-\d{2}-\d{2}$/.test(record.occurredAt) && Number.isFinite(record.lat) && Number.isFinite(record.lon));

  let crimeExposure = 0, trafficAccidentExposure = 0, crimeEvents = 0, trafficEvents = 0;
  const categoryCounts: Record<string, Record<string, number>> = { crime: {}, traffic_accident: {} };
  for (const record of valid) {
    const distance = distanceToRoute(record, geometry);
    if (distance > RISK_SEARCH_RADIUS_M) continue;
    const ageDays = Math.max(0, (Date.now() - Date.parse(`${record.occurredAt}T00:00:00Z`)) / 86400000);
    const freshness = Math.exp(-Math.LN2 * ageDays / FRESHNESS_HALF_LIFE_DAYS);
    // Qamqor provides point geometries but no metre-level accuracy metadata.
    // Unknown accuracy receives a conservative 0.5 quality factor; known accuracy is discounted continuously.
    const accuracy = record.precision_m ?? record.source_precision_m;
    const quality = accuracy == null ? 0.5 : Math.max(0.25, 1 / (1 + Math.max(0, accuracy) / RISK_SEARCH_RADIUS_M));
    const temporalCoverage = periodCoverage(sourceByType.get(record.event_type), period) / 100;
    const contribution = Math.max(0, 1 - distance / RISK_SEARCH_RADIUS_M) * freshness * quality * temporalCoverage;
    if (record.event_type === 'crime') { crimeExposure += contribution; crimeEvents++; }
    else { trafficAccidentExposure += contribution; trafficEvents++; }
    const code = record.category_code || 'код не указан';
    categoryCounts[record.event_type][code] = (categoryCounts[record.event_type][code] ?? 0) + 1;
  }

  const routeKm = geometryLengthMeters(geometry) / 1000;
  const nearbyEvents = crimeEvents + trafficEvents;
  const enoughEvents = nearbyEvents >= MIN_ROUTE_EVENTS;
  const hasTemporalData = coverage.some((item) => item.temporal_coverage_percent > 0);
  const completenessKnown = coverage.some((item) => item.statistical_completeness_percent !== null);
  const accuracyKnown = coverage.some((item) => item.coordinate_accuracy_m !== null);
  const explanation = `В радиусе ${RISK_SEARCH_RADIUS_M} м: ${crimeEvents} записей о преступлениях и ${trafficEvents} ДТП за ${period.from}–${period.to}. Учитываются все категории выбранного типа; неизвестным кодам не назначается тяжесть. У записей нет стабильного ID: совпадения даты, категории и координат могут включать повторы или разные события. Взвешенная историческая экспозиция рассчитывается по расстоянию, давности (период полураспада ${FRESHNESS_HALF_LIFE_DAYS} дней), точности координат и диапазону дат источника, затем приводится к фактической длине маршрута. Диапазон дат между первой и последней записью не подтверждает полноту ежедневной выгрузки. Неизвестная точность координат получает коэффициент 0,5; статистическая полнота ${completenessKnown ? 'указана источником' : 'источником не опубликована'}, точность координат ${accuracyKnown ? 'указана' : 'не опубликована'}. Это историческая взвешенная экспозиция, а не вероятность происшествия или мера безопасности.`;

  return {
    score: null,
    confidence: enoughEvents && hasTemporalData ? 'limited' : 'insufficient_data',
    version: RISK_MODEL_VERSION,
    explanation: enoughEvents && hasTemporalData ? explanation : `${explanation} Недостаточно данных для устойчивой оценки: требуется не менее ${MIN_ROUTE_EVENTS} событий рядом с маршрутом и записи за выбранный период. Отсутствие событий не означает низкий риск.`,
    nearby_events: nearbyEvents,
    crime_events: crimeEvents,
    traffic_accident_events: trafficEvents,
    crime_exposure: Number(crimeExposure.toFixed(3)),
    traffic_accident_exposure: Number(trafficAccidentExposure.toFixed(3)),
    crime_exposure_per_km: routeKm > 0 ? Number((crimeExposure / routeKm).toFixed(3)) : 0,
    traffic_accident_exposure_per_km: routeKm > 0 ? Number((trafficAccidentExposure / routeKm).toFixed(3)) : 0,
    category_counts: categoryCounts,
    coverage,
  };
}

export function compareRouteExposures(assessments: RouteExposure[]) {
  const comparable = assessments.map((assessment, index) => ({ assessment, index })).filter(({ assessment }) => assessment.confidence !== 'insufficient_data');
  const byType = (type: 'crime' | 'traffic_accident') => comparable.map(({ assessment }) => type === 'crime' ? assessment.crime_exposure_per_km : assessment.traffic_accident_exposure_per_km);
  const percentile = (values: number[], index: number) => {
    const current = values[index];
    if (values.length < 2) return null;
    const less = values.filter((value) => value < current).length;
    const equal = values.filter((value) => value === current).length;
    return Math.round(((less + (equal - 1) / 2) / (values.length - 1)) * 100);
  };
  return assessments.map((assessment, index) => {
    if (assessment.confidence === 'insufficient_data') return assessment;
    const comparableIndex = comparable.findIndex((item) => item.index === index);
    const components = (['crime', 'traffic_accident'] as const).flatMap((type) => {
      const values = byType(type);
      const min = Math.min(...values), max = Math.max(...values);
      if (values.length < 2 || max === min || max <= 0) return [];
      const rank = percentile(values, comparableIndex);
      if (rank === null) return [];
      // Keep close alternatives close to the midpoint instead of turning any
      // rank difference into misleading 0/100 endpoints in a three-route set.
      const relativeSpread = (max - min) / max;
      return [{ value: 50 + (rank - 50) * relativeSpread, relativeSpread }];
    });
    if (!components.length) return {
      ...assessment, score: null,
      explanation: `${assessment.explanation} Взвешенная историческая экспозиция совпадает у сравниваемых вариантов; относительный индекс не присваивается.`,
    };
    const score = Math.max(0, Math.min(100, Math.round(components.reduce((sum, item) => sum + item.value, 0) / components.length)));
    const spread = Math.round(components.reduce((sum, item) => sum + item.relativeSpread, 0) / components.length * 1000) / 10;
    return { ...assessment, score, confidence: 'limited' as const,
      explanation: `${assessment.explanation} Относительный индекс ${score}/100 учитывает порядок и величину различий только между этими вариантами; диапазон их взвешенной экспозиции — ${spread}% от максимума. Он не показывает абсолютную опасность, вероятность события или безопасность, и не сопоставим с другими маршрутами.`,
    };
  });
}
