import { dbErrorResponse, incidentCategories } from '@/db';
export async function GET() { try { return Response.json({ items: await incidentCategories(), data_mode: 'demo' }); } catch (error) { return dbErrorResponse(error); } }
