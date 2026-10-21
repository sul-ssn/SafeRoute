import { z } from 'zod';

const querySchema = z.object({ q: z.string().trim().min(3).max(160) });

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | number | undefined>;
};

export async function GET(request: Request) {
  const parsed = querySchema.safeParse({ q: new URL(request.url).searchParams.get('q') ?? '' });
  if (!parsed.success) return Response.json({ results: [] }, { status: 400 });

  const url = new URL('https://photon.komoot.io/api/');
  url.search = new URLSearchParams({
    q: parsed.data.q,
    lat: '51.128',
    lon: '71.430',
    zoom: '12',
    limit: '6',
    lang: 'ru',
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
      const name = String(properties.name ?? properties.street ?? 'Место');
      const detail = [properties.housenumber, properties.street, properties.district, properties.city ?? properties.locality, properties.state]
        .filter((part): part is string | number => part !== undefined && part !== null && String(part).trim().length > 0)
        .map(String)
        .filter((part, partIndex, all) => all.indexOf(part) === partIndex && part !== name);
      return [{ id: String(properties.osm_id ?? `${coordinates[0]}:${coordinates[1]}:${index}`), label: name, detail: detail.join(', '), lon: coordinates[0], lat: coordinates[1] }];
    });
    return Response.json({ results }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } });
  } catch {
    return Response.json({ error: 'Не удалось выполнить поиск мест.' }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
