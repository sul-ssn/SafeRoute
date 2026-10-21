import { z } from 'zod';

const querySchema = z.object({
  q: z.string().trim().min(3).max(160),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
}).superRefine((value, context) => {
  if ((value.lat === undefined) !== (value.lon === undefined)) {
    context.addIssue({ code: 'custom', message: 'Координаты поиска должны содержать широту и долготу.' });
  }
});

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | number | undefined>;
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: requestUrl.searchParams.get('q') ?? '',
    lat: requestUrl.searchParams.has('lat') ? requestUrl.searchParams.get('lat') : undefined,
    lon: requestUrl.searchParams.has('lon') ? requestUrl.searchParams.get('lon') : undefined,
  });
  if (!parsed.success) return Response.json({ results: [] }, { status: 400 });

  const url = new URL('https://photon.komoot.io/api/');
  url.search = new URLSearchParams({
    q: parsed.data.q,
    lat: String(parsed.data.lat ?? 51.128),
    lon: String(parsed.data.lon ?? 71.430),
    zoom: parsed.data.lat === undefined ? '12' : '15',
    location_bias_scale: '0',
    countrycode: 'KZ',
    limit: '8',
  }).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/geo+json, application/json' },
      next: { revalidate: 300 },
    });
    if (!response.ok) return Response.json({ error: 'Поиск мест временно недоступен.' }, { status: 503 });
    const payload = await response.json() as { features?: PhotonFeature[] };
    const results = (payload.features ?? []).flatMap((feature, index) => {
      const coordinates = feature.geometry?.coordinates;
      if (!coordinates || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) return [];
      const properties = feature.properties ?? {};
      const address = [properties.housenumber, properties.street].filter((part) => part !== undefined && part !== null && String(part).trim()).map(String).join(', ');
      const name = String(properties.name ?? address ?? properties.district ?? properties.city ?? properties.locality ?? 'Место');
      const detail = [properties.housenumber, properties.street, properties.district, properties.suburb, properties.locality, properties.city, properties.county, properties.state, properties.postcode]
        .filter((part): part is string | number => part !== undefined && part !== null && String(part).trim().length > 0)
        .map(String)
        .filter((part, partIndex, all) => all.indexOf(part) === partIndex && part !== name);
      const organizationKinds: Record<string,string> = {restaurant:'Ресторан',cafe:'Кафе',fast_food:'Быстрое питание',pharmacy:'Аптека',hospital:'Больница',clinic:'Клиника',school:'Школа',university:'Университет',supermarket:'Супермаркет',convenience:'Магазин',mall:'Торговый центр',bank:'Банк',fuel:'АЗС',hotel:'Отель',museum:'Музей',cinema:'Кинотеатр',theatre:'Театр'};
      if (typeof properties.osm_value === 'string' && organizationKinds[properties.osm_value]) detail.unshift(organizationKinds[properties.osm_value]);
      return [{ id: String(properties.osm_id ?? `${coordinates[0]}:${coordinates[1]}:${index}`), label: name, detail: detail.join(', '), lon: coordinates[0], lat: coordinates[1] }];
    });
    return Response.json({ results }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } });
  } catch {
    return Response.json({ error: 'Не удалось выполнить поиск мест.' }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
