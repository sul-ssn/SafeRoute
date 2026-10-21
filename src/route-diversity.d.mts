export type RoutableGeometry = { geometry: { coordinates: [number, number][] } } | [number, number][];
export function routeDifferenceRatio(first: RoutableGeometry, second: RoutableGeometry, toleranceMeters?: number, spacingMeters?: number): number;
export function filterDistinctRoutes<T extends RoutableGeometry>(routes: T[], options?: { toleranceMeters?: number; minimumDifference?: number }): T[];
