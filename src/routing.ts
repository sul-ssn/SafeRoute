export type Point = { lat: number; lon: number };
export type GeoJsonLineString = { type: 'LineString'; coordinates: [number, number][] };
export type TravelProfile = 'foot' | 'bicycle' | 'car' | 'motorcycle';

export type RouteManeuver = {
  instruction: string;
  length_m: number;
  duration_s: number;
  begin_index: number;
  end_index: number;
  type: number;
  travel_mode: string;
};

type ValhallaManeuver = {
  instruction?: string;
  length?: number;
  time?: number;
  begin_shape_index?: number;
  end_shape_index?: number;
  type?: number;
  travel_mode?: string;
};

type ValhallaLeg = { shape?: string | GeoJsonLineString; maneuvers?: ValhallaManeuver[] };

type ValhallaRoute = {
  trip?: {
    summary?: { time?: number; length?: number };
    legs?: ValhallaLeg[];
    locations?: { lat: number; lon: number; type?: string }[];
  };
  alternates?: { trip?: ValhallaRoute['trip'] }[];
  error?: string;
};

function decodePolyline6(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0, lat = 0, lon = 0;
  while (index < encoded.length) {
    const values: number[] = [];
    for (let axis = 0; axis < 2; axis++) {
      let result = 0, shift = 0, byte: number;
      do {
        if (index >= encoded.length || shift > 30) throw new Error('Некорректная геометрия маршрута.');
        byte = encoded.charCodeAt(index++) - 63;
        if (byte < 0 || byte > 63) throw new Error('Некорректная геометрия маршрута.');
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      values.push((result & 1) ? ~(result >> 1) : result >> 1);
    }
    lat += values[0]; lon += values[1];
    points.push([lon / 1e6, lat / 1e6]);
  }
  return points;
}

function legGeometry(leg: ValhallaLeg): [number, number][] {
  if (typeof leg.shape === 'string') return decodePolyline6(leg.shape);
  if (leg.shape?.type === 'LineString') return leg.shape.coordinates;
  return [];
}

function normalizeTrip(trip: NonNullable<ValhallaRoute['trip']>, id: string) {
  const coordinates: [number, number][] = [];
  const maneuvers: RouteManeuver[] = [];
  for (const leg of trip.legs ?? []) {
    const points = legGeometry(leg);
    if (points.length < 2) continue;
    const offset = coordinates.length ? coordinates.length - 1 : 0;
    coordinates.push(...(coordinates.length ? points.slice(1) : points));
    for (const maneuver of leg.maneuvers ?? []) {
      const begin = Number(maneuver.begin_shape_index ?? 0);
      const end = Number(maneuver.end_shape_index ?? begin);
      if (!maneuver.instruction || !Number.isFinite(begin) || !Number.isFinite(end)) continue;
      maneuvers.push({
        instruction: maneuver.instruction,
        length_m: Math.max(0, Math.round(Number(maneuver.length ?? 0) * 1000)),
        duration_s: Math.max(0, Math.round(Number(maneuver.time ?? 0))),
        begin_index: begin + offset,
        end_index: end + offset,
        type: Number(maneuver.type ?? 0),
        travel_mode: maneuver.travel_mode ?? 'drive',
      });
    }
  }
  if (coordinates.length < 2) throw new Error('Маршрутизатор не вернул геометрию маршрута.');

  // Valhalla returns the route ETA in seconds, computed by its selected costing
  // profile from the graph. Do not substitute a UI-side distance/speed formula.
  const duration = Number(trip.summary?.time);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Маршрутизатор не вернул расчётное время поездки.');
  return {
    id,
    distance_m: Math.round(geometryLengthMeters({ type: 'LineString', coordinates })),
    duration_s: Math.round(duration),
    duration_source: 'valhalla_graph_estimate' as const,
    geometry: { type: 'LineString' as const, coordinates },
    maneuvers,
  };
}

export function geometryLengthMeters(geometry: GeoJsonLineString): number {
  const radius = 6371008.8;
  let length = 0;
  for (let i = 1; i < geometry.coordinates.length; i++) {
    const [lon1, lat1] = geometry.coordinates[i - 1];
    const [lon2, lat2] = geometry.coordinates[i];
    const radians = Math.PI / 180;
    const dLat = (lat2 - lat1) * radians, dLon = (lon2 - lon1) * radians;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
    length += 2 * radius * Math.asin(Math.sqrt(h));
  }
  return length;
}

const costingByProfile: Record<TravelProfile, string> = {
  foot: 'pedestrian',
  bicycle: 'bicycle',
  car: 'auto',
  motorcycle: 'motorcycle',
};

export async function buildRoutes(origin: Point, destination: Point, profile: TravelProfile, preference: string) {
  const base = (process.env.VALHALLA_BASE_URL || 'https://valhalla1.openstreetmap.de').replace(/\/$/, '');
  const costing = costingByProfile[profile];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${base}/route`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'SafeRoute' },
      body: JSON.stringify({
        locations: [{ ...origin, radius: 100 }, { ...destination, radius: 100 }],
        costing,
        costing_options: { [costing]: { use_ferry: 0.0 } },
        units: 'kilometers',
        shape_format: 'geojson',
        alternates: 2,
        directions_options: { units: 'kilometers', language: 'ru-RU', directions_type: 'instructions' },
      }),
    });
    const payload = await response.json().catch(() => null) as ValhallaRoute | null;
    if (!response.ok || !payload?.trip) {
      if (response.status === 400 || response.status === 404) throw Object.assign(new Error('Не удалось привязать точки к сети для выбранного транспорта. Попробуйте поставить их ближе к доступной дороге или пути.'), { code: 'NO_ROUTE', status: 422 });
      throw Object.assign(new Error('Сервис маршрутизации временно недоступен.'), { code: 'ROUTER_UNAVAILABLE', status: 503 });
    }
    const routes = [payload.trip, ...(payload.alternates ?? []).map((alternate) => alternate.trip).filter((trip): trip is NonNullable<typeof trip> => !!trip)]
      .map((trip, index) => normalizeTrip(trip, `${costing}-${index + 1}`));
    const unique = routes.filter((route, index) => routes.findIndex((candidate) => candidate.geometry.coordinates.length === route.geometry.coordinates.length && candidate.geometry.coordinates.every((point, i) => point[0] === route.geometry.coordinates[i][0] && point[1] === route.geometry.coordinates[i][1])) === index);
    const ordered = preference === 'shortest' ? [...unique].sort((a, b) => a.distance_m - b.distance_m) : unique;
    return ordered.map((route, index) => ({ ...route, id: `${costing}-${index + 1}` }));
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error;
    const timeoutError = error instanceof Error && error.name === 'AbortError';
    throw Object.assign(new Error(timeoutError ? 'Истекло время ожидания ответа маршрутизатора.' : 'Не удалось связаться с сервисом маршрутизации.'), { code: 'ROUTER_UNAVAILABLE', status: 503 });
  } finally { clearTimeout(timeout); }
}
