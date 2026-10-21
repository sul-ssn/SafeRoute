export type IncidentPeriodPreset = '7d' | '30d' | '90d' | 'all';

export function incidentPeriodRange(preset: IncidentPeriodPreset, today: string) {
  const timestamp = Date.parse(`${today}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== today) {
    throw new Error('today must be a calendar date in YYYY-MM-DD format');
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : preset === '90d' ? 90 : null;
  if (!days) return { from: '2026-01-01', to: today };
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { from: start.toISOString().slice(0, 10), to: today };
}
