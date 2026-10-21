export type Incident = {
  id: string; category: string; occurredAt: string; lat: number; lon: number;
  sourceId: string; sourceName: string; recordLevel: 'point' | 'cell'; synthetic: boolean;
  dataMode?: 'demo' | 'real' | 'aggregate' | 'unverified';
  eventType?: 'crime' | 'traffic_accident' | 'other'; categoryCode?: string;
};

export type MapAggregate = {
  event_type: 'crime' | 'traffic_accident'; category_code: string; count: number;
  lon: number; lat: number; first_date: string; last_date: string; record_level: 'cell';
};

export const demoSource = {
  id: 'demo-astana-2026', name: 'SafeRoute DEMO — учебный набор',
  description: 'Синтетические события для проверки интерфейса. Не отражают реальную безопасность города.',
  sourceUrl: null, licenseNotes: 'Тестовые данные, только для демонстрации.',
  dataMode: 'demo' as const, coverageStart: '2026-01-01', coverageEnd: '2026-09-30',
  retrievedAt: '2026-10-01T00:00:00.000Z', lastImportAt: '2026-10-01T00:00:00.000Z',
};
export const categories = ['ДТП', 'Освещение', 'Прочее'];
