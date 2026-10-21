import { dbErrorResponse, query } from '@/db';
export async function GET() {
  try { const result = await query<{ postgis_version: string }>('SELECT PostGIS_Full_Version() AS postgis_version'); return Response.json({ status: 'ok', service: 'saferoute', version: '0.1.0', database: 'postgresql', postgis: result.rows[0].postgis_version }); }
  catch (error) { return dbErrorResponse(error); }
}
