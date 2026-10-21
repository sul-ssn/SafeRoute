import { incidentCategories, listIncidents } from '@/db';
import type { Incident } from '@/data';

export async function getUiIncidents(): Promise<Incident[]> {
  const result = await listIncidents({ limit: 1000 });
  return result.items.filter((item) => item.lat !== null && item.lon !== null).map((item) => ({
    id: String(item.id), category: String(item.category), occurredAt: String(item.occurred_at ?? ''), lat: Number(item.lat), lon: Number(item.lon),
    sourceId: String(item.source_id), sourceName: String(item.source_name), recordLevel: Number(item.spatial_precision_m ?? Infinity) <= 100 ? 'point' : 'cell',
    synthetic: Boolean(item.is_synthetic) || item.data_mode === 'demo', dataMode: item.data_mode,
  }));
}

export async function getUiCategories() {
  const result = await incidentCategories(); return result.map((item) => item.category);
}
