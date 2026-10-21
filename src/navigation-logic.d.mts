export type NavigationPoint = { lat: number; lon: number };
export type RouteCoordinate = [number, number];
export type RouteProgress = { segmentIndex: number; progress_m: number };
export type RouteMatch = RouteProgress & { distance_m: number; score: number; directionDifference: number; matched: boolean };
export type NavigationManeuver = { end_index: number };

export function pointDistanceMeters(a: NavigationPoint, b: NavigationPoint): number;
export function routeCumulativeMeters(coordinates: RouteCoordinate[]): number[];
export function matchRoutePosition(
  point: NavigationPoint,
  coordinates: RouteCoordinate[],
  previous: RouteProgress | null,
  cumulative: number[],
  maxAdvance: number,
  motion?: { elapsedSeconds?: number; speedMps?: number; heading?: number | null },
): RouteMatch;
export function validGpsPosition(position: GeolocationPosition, now?: number): boolean;
export function navigationContextIsCurrent(captured: { routeVersion: number; session: number }, active: { routeVersion: number; session: number }): boolean;
export function plausibleGpsTransition(
  previous: { point: NavigationPoint; timestamp: number; accuracy: number } | null,
  next: { point: NavigationPoint; timestamp: number; accuracy: number },
  maxSpeed: number,
): boolean;
export function offRouteThreshold(accuracy: number): number;
export function updateOffRouteFixCount(previousCount: number, distance: number, threshold: number, confirmations?: number): { count: number; confirmed: boolean };
export function advanceManeuverOneStep(current: number, maneuvers: NavigationManeuver[], previousProgress: number, progress: number, cumulative: number[], lastAdvanceProgress?: number, margin?: number): number;
export function nextVoiceCue(routeId: string, maneuverIndex: number, instruction: string, remainingMeters: number, profile: 'foot' | 'bicycle' | 'car' | 'motorcycle', announced: Set<string>): string | null;
export type NavigationFix = { point: NavigationPoint; timestamp: number; accuracy: number };
export function updateArrivalConfirmation(previousCount: number, accuracy: number, speed: number | null, destinationDistance: number, previousFix: NavigationFix | null, currentFix: NavigationFix): { count: number; arrived: boolean };

export class LatestRouteRequestGate {
  begin(options?: { replace?: boolean }): null | {
    id: number;
    signal: AbortSignal;
    isCurrent(): boolean;
    finish(): boolean;
  };
  cancel(): void;
}
