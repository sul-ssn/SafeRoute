import { dbErrorResponse, incidentHotspots } from '@/db';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try { const items = await incidentHotspots({ category: params.get('category') ?? undefined }); return Response.json({ items, data_mode: 'real', record_level: 'cell', attribution: 'Информация получена с официального интернет-портала qamqor.gov.kz' }); }
  catch (error) { return dbErrorResponse(error); }
}
