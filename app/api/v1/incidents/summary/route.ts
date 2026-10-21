import { dbErrorResponse, incidentSummary } from '@/db';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try { return Response.json({ ...(await incidentSummary({ category: params.get('category') ?? undefined, from: params.get('from') ?? undefined, to: params.get('to') ?? undefined })), data_mode: 'demo' }); }
  catch (error) { return dbErrorResponse(error); }
}
