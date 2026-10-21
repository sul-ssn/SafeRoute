import { dbErrorResponse, listSources } from '@/db';

export async function GET() {
  try {
    const items = (await listSources()).map(({ id, name, description, source_url, license_notes, data_mode, coverage_start, coverage_end, retrieved_at, last_import_at, incident_count }) => ({
      id, name, description, source_url, license_notes, data_mode, coverage_start, coverage_end, retrieved_at, last_import_at, incident_count,
    }));
    return Response.json({ items, total: items.length });
  } catch (error) { return dbErrorResponse(error); }
}
