export const MAX_RISK_SOURCE_AGE_DAYS: number;
export type RiskDataStatus = 'available' | 'no_nearby_events' | 'no_source_data' | 'insufficient_statistics' | 'source_error' | 'stale_snapshot' | 'unavailable';
export type RouteRiskDataStatus = { status: RiskDataStatus; sourceAgeDays: number | null; maxAgeDays: number; staleReason: 'sync_error' | 'age_unknown' | 'age_limit' | null };
export function loadOptionalRouteRisk<Route, Result>(route: Route, load: (route: Route) => Promise<Result>, unavailable: (route: Route) => Result | Promise<Result>): Promise<Result>;
export function classifyRouteRiskData(args: {
  sources: Array<{ record_count: number; retrieved_at: string | Date | null; last_sync_status?: string | null }>;
  records: unknown[];
  riskConfidence?: string;
  queryFailed?: boolean;
  now?: number;
  maxAgeDays?: number;
}): RouteRiskDataStatus;
export function canRankByRiskExposure(assessments: Array<{ status: RiskDataStatus; confidence: string; sourceAgeDays: number | null }>, maxAgeDays?: number): boolean;
