export const MAX_RISK_SOURCE_AGE_DAYS = 30;

export async function loadOptionalRouteRisk(route, load, unavailable) {
  try {
    return await load(route);
  } catch {
    return unavailable(route);
  }
}

export function classifyRouteRiskData({ sources, records, riskConfidence, queryFailed = false, now = Date.now(), maxAgeDays = MAX_RISK_SOURCE_AGE_DAYS }) {
  if (queryFailed) return { status: 'unavailable', sourceAgeDays: null, maxAgeDays, staleReason: null };

  const sourceHasRows = sources.some((source) => Number(source.record_count) > 0);
  const syncFailed = sources.some((source) => source.last_sync_status === 'failed');
  const retrievedAt = sources.map((source) => source.retrieved_at == null ? null : new Date(source.retrieved_at).getTime());
  const unknownAge = retrievedAt.some((timestamp) => timestamp == null || !Number.isFinite(timestamp));
  const sourceAgeDays = retrievedAt.length && !unknownAge
    ? Math.max(0, Math.floor(Math.max(...retrievedAt.map((timestamp) => (now - timestamp) / 86400000))))
    : null;
  const expired = sources.length > 0 && (unknownAge || sourceAgeDays > maxAgeDays);

  if (!sourceHasRows && syncFailed) return { status: 'source_error', sourceAgeDays, maxAgeDays, staleReason: 'sync_error' };
  if (!sourceHasRows) return { status: 'no_source_data', sourceAgeDays, maxAgeDays, staleReason: null };
  if (syncFailed || expired) return { status: 'stale_snapshot', sourceAgeDays, maxAgeDays, staleReason: syncFailed ? 'sync_error' : unknownAge ? 'age_unknown' : 'age_limit' };
  if (records.length === 0) return { status: 'no_nearby_events', sourceAgeDays, maxAgeDays, staleReason: null };
  if (riskConfidence === 'insufficient_data') return { status: 'insufficient_statistics', sourceAgeDays, maxAgeDays, staleReason: null };
  return { status: 'available', sourceAgeDays, maxAgeDays, staleReason: null };
}

export function canRankByRiskExposure(assessments, maxAgeDays = MAX_RISK_SOURCE_AGE_DAYS) {
  return assessments.every(({ status, confidence, sourceAgeDays }) => {
    const fresh = status === 'available';
    const recentSnapshot = status === 'stale_snapshot' && sourceAgeDays != null && sourceAgeDays <= maxAgeDays;
    return (fresh || recentSnapshot) && confidence !== 'insufficient_data';
  });
}
