export function GET() {
  return Response.json({
    providers: [{ id: 'valhalla', name: 'Valhalla · OpenStreetMap', available: true, real_service: true, profile: 'pedestrian', graph_source: 'OpenStreetMap', notice: 'Маршрутизатор использует OSM pedestrian costing; детализация тротуаров и проходов зависит от карты.' }],
    default_provider: 'valhalla',
  });
}
