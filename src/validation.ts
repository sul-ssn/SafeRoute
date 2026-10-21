import { z } from 'zod';

export const querySchema=z.object({
  from:z.string().date().optional(),to:z.string().date().optional(),category:z.string().trim().min(1).max(80).optional(),
  source_id:z.string().trim().min(1).max(120).optional(),page:z.coerce.number().int().min(1).max(100000).default(1),
  page_size:z.coerce.number().int().min(1).max(200).default(100),
});
export const routeRequestSchema=z.object({
  origin:z.object({lat:z.number().finite().min(-90).max(90),lon:z.number().finite().min(-180).max(180)}),
  destination:z.object({lat:z.number().finite().min(-90).max(90),lon:z.number().finite().min(-180).max(180)}),
  profile:z.enum(['foot','bicycle','car','motorcycle']).default('foot'),preference:z.enum(['balanced','shortest','less_events']).default('balanced'),
  from:z.string().date().optional(),to:z.string().date().optional(),
}).refine((data)=>!data.from||!data.to||data.from<=data.to,{path:['to'],message:'Дата окончания должна быть не раньше даты начала.'});
