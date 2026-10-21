import assert from 'node:assert/strict';
import test from 'node:test';
import { filterDistinctRoutes, routeDifferenceRatio } from './route-diversity.mjs';

const center = [71.43, 51.12];
const metersToLon = (meters) => meters / (111320 * Math.cos(center[1] * Math.PI / 180));
const metersToLat = (meters) => meters / 111320;
const line = (offset, detour = false) => {
  if (detour) return [
    [center[0] + metersToLon(offset), center[1]],
    [center[0] + metersToLon(offset), center[1] + metersToLat(300)],
    [center[0] + metersToLon(offset + 120), center[1] + metersToLat(500)],
    [center[0] + metersToLon(offset), center[1] + metersToLat(700)],
    [center[0] + metersToLon(offset), center[1] + metersToLat(1000)],
  ];
  return [[center[0] + metersToLon(offset), center[1]], [center[0] + metersToLon(offset), center[1] + metersToLat(1000)]];
};

test('small geometry changes on the same road are not presented as separate alternatives', () => {
  assert.ok(routeDifferenceRatio(line(0), line(18)) < 0.16);
  const routes = filterDistinctRoutes([{ id: 'main', geometry: { coordinates: line(0) } }, { id: 'near-copy', geometry: { coordinates: line(18) } }]);
  assert.deepEqual(routes.map((route) => route.id), ['main']);
});

test('a different parallel corridor and a meaningful detour remain available for comparison', () => {
  const routes = filterDistinctRoutes([
    { id: 'main', geometry: { coordinates: line(0) } },
    { id: 'parallel', geometry: { coordinates: line(100) } },
    { id: 'detour', geometry: { coordinates: line(0, true) } },
  ]);
  assert.deepEqual(routes.map((route) => route.id), ['main', 'parallel', 'detour']);
  assert.ok(routeDifferenceRatio(line(0), line(100)) > 0.8);
});
