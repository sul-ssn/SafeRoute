import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LatestRouteRequestGate,
  advanceManeuverOneStep,
  matchRoutePosition,
  navigationContextIsCurrent,
  offRouteThreshold,
  plausibleGpsTransition,
  routeCumulativeMeters,
  updateArrivalConfirmation,
  updateOffRouteFixCount,
  validGpsPosition,
} from './navigation-logic.mjs';
import { canRankByRiskExposure, classifyRouteRiskData, loadOptionalRouteRisk, MAX_RISK_SOURCE_AGE_DAYS } from './risk-data-logic.mjs';

const now = 1_800_000_000_000;
const origin = { lat: 51, lon: 71.4 };
const metersPerLonAt51 = 111320 * Math.cos(51 * Math.PI / 180);
const lonAtMeters = (meters) => origin.lon + meters / metersPerLonAt51;
const line = [[origin.lon, origin.lat], [origin.lon, origin.lat + 0.003]];

function matcher(point, coordinates = line, previous = null, motion = {}) {
  const cumulative = routeCumulativeMeters(coordinates);
  return matchRoutePosition(point, coordinates, previous, cumulative, 1000, motion);
}

test('one GPS jump of 100–200 m is rejected and does not mark the real path as off-route', () => {
  const previous = { point: origin, timestamp: now, accuracy: 5 };
  const jump = { point: { lat: 51, lon: lonAtMeters(150) }, timestamp: now + 1000, accuracy: 5 };
  assert.equal(plausibleGpsTransition(previous, jump, 10), false);
  const onRoute = matcher({ lat: 51.001, lon: 71.4 });
  const state = updateOffRouteFixCount(0, onRoute.distance_m, offRouteThreshold(5));
  assert.equal(state.confirmed, false);
});

test('three consistent accurate fixes away from the route confirm a real deviation', () => {
  let count = 0;
  for (let index = 0; index < 3; index++) {
    const result = updateOffRouteFixCount(count, 80, offRouteThreshold(5));
    count = result.count;
    if (index < 2) assert.equal(result.confirmed, false);
    else assert.equal(result.confirmed, true);
  }
});

test('a parallel road is not mistaken for the route when GPS is precise', () => {
  const pointOnParallelRoad = { lat: 51.001, lon: lonAtMeters(32) };
  const match = matcher(pointOnParallelRoad);
  assert.ok(Math.abs(match.distance_m - 32) < 2);
  assert.ok(match.distance_m > offRouteThreshold(5));
});

test('self-intersection matching continues from the previous segment and does not jump backwards', () => {
  const crossing = [[0, 0], [0.001, 0.001], [0.002, 0], [0.001, -0.001], [0, 0]];
  const cumulative = routeCumulativeMeters(crossing);
  const previous = { segmentIndex: 3, progress_m: cumulative[3] + 80 };
  const match = matchRoutePosition({ lat: 0, lon: 0 }, crossing, previous, cumulative, 150, { elapsedSeconds: 3, speedMps: 4, heading: 315 });
  assert.ok(match.segmentIndex >= 2);
  assert.ok(match.progress_m >= previous.progress_m);
});

const northAtMeters = (meters) => origin.lat + meters / 111320;
const measuredRoute = Array.from({ length: 11 }, (_, index) => [origin.lon, northAtMeters(index * 50)]);
const measuredCumulative = routeCumulativeMeters(measuredRoute);

test('turning onto a new road cannot pull progress forward to a distant route segment', () => {
  const previous = { segmentIndex: 1, progress_m: 50 };
  const diverted = matchRoutePosition(
    { lat: northAtMeters(220), lon: lonAtMeters(24) },
    measuredRoute,
    previous,
    measuredCumulative,
    30,
  );
  assert.equal(diverted.matched, false);
  assert.equal(diverted.progress_m, previous.progress_m);
  assert.equal(diverted.segmentIndex, previous.segmentIndex);
  assert.ok(diverted.distance_m < 30);
});

test('a U-turn behind the cursor cannot move progress backwards or jump ahead', () => {
  const previous = { segmentIndex: 4, progress_m: 200 };
  const turnedBack = matchRoutePosition(
    { lat: northAtMeters(100), lon: origin.lon },
    measuredRoute,
    previous,
    measuredCumulative,
    25,
    { elapsedSeconds: 3, speedMps: 5, heading: 180 },
  );
  assert.equal(turnedBack.matched, false);
  assert.equal(turnedBack.progress_m, previous.progress_m);
  assert.equal(turnedBack.segmentIndex, previous.segmentIndex);
  assert.ok(turnedBack.distance_m < 2);
});

test('after an off-route fix, returning to a reachable route segment resumes progress', () => {
  const previous = { segmentIndex: 2, progress_m: measuredCumulative[2] };
  const diverted = matchRoutePosition(
    { lat: northAtMeters(220), lon: lonAtMeters(24) }, measuredRoute, previous, measuredCumulative, 30,
  );
  assert.equal(diverted.matched, false);
  const returned = matchRoutePosition(
    { lat: northAtMeters(112), lon: origin.lon }, measuredRoute, previous, measuredCumulative, 40,
  );
  assert.equal(returned.matched, true);
  assert.ok(returned.progress_m > previous.progress_m);
  assert.ok(returned.progress_m < previous.progress_m + 40);
});

test('one accepted GPS sample cannot advance multiple maneuvers', () => {
  const cumulative = [0, 10, 20, 30, 40];
  const maneuvers = [0, 1, 2, 3].map((end_index) => ({ end_index }));
  assert.equal(advanceManeuverOneStep(0, maneuvers, 0, 39, cumulative, 0), 1);
  assert.equal(advanceManeuverOneStep(1, maneuvers, 39, 39, cumulative, 39), 1);
  assert.equal(advanceManeuverOneStep(1, maneuvers, 39, 46.9, cumulative, 39), 1);
  assert.equal(advanceManeuverOneStep(1, maneuvers, 46.9, 47, cumulative, 39), 2);
});

test('missing speed alone does not confirm arrival; GPS movement does', () => {
  const destination = { lat: 51, lon: 71.4 };
  const movedPrevious = { point: destination, timestamp: now, accuracy: 5 };
  const movedCurrent = { point: { lat: 51, lon: lonAtMeters(8) }, timestamp: now + 1000, accuracy: 5 };
  let result = updateArrivalConfirmation(2, 5, null, 5, movedPrevious, movedCurrent);
  assert.equal(result.arrived, false);
  assert.equal(result.count, 0);
  result = updateArrivalConfirmation(0, 5, null, 5, null, movedCurrent);
  assert.equal(result.arrived, false);

  const stationaryPrevious = { point: destination, timestamp: now, accuracy: 5 };
  const stationaryCurrent = { point: destination, timestamp: now + 1000, accuracy: 5 };
  result = updateArrivalConfirmation(0, 5, null, 5, stationaryPrevious, stationaryCurrent);
  assert.equal(result.arrived, false);
  result = updateArrivalConfirmation(result.count, 5, null, 5,
    stationaryCurrent,
    { ...stationaryCurrent, timestamp: now + 2000 });
  assert.equal(result.arrived, false);
  result = updateArrivalConfirmation(result.count, 5, null, 5,
    { ...stationaryCurrent, timestamp: now + 2000 },
    { ...stationaryCurrent, timestamp: now + 3000 });
  assert.equal(result.arrived, true);
});

test('stale and low-accuracy GPS fixes are rejected', () => {
  const base = { timestamp: now, coords: { latitude: 51, longitude: 71, accuracy: 4 } };
  assert.equal(validGpsPosition(base, now), true);
  assert.equal(validGpsPosition({ ...base, timestamp: now - 16_000 }, now), false);
  assert.equal(validGpsPosition({ ...base, coords: { ...base.coords, accuracy: 51 } }, now), false);
});

test('GPS callbacks from an older route or navigation session cannot update the new one', () => {
  const captured = { routeVersion: 4, session: 8 };
  assert.equal(navigationContextIsCurrent(captured, { routeVersion: 4, session: 8 }), true);
  assert.equal(navigationContextIsCurrent(captured, { routeVersion: 5, session: 8 }), false);
  assert.equal(navigationContextIsCurrent(captured, { routeVersion: 4, session: 9 }), false);
});

test('newer reroute wins if requests resolve in reverse order; automatic duplicate is locked', async () => {
  const gate = new LatestRouteRequestGate();
  const oldRequest = gate.begin({ replace: true });
  const blockedAutomatic = gate.begin({ replace: false });
  assert.equal(blockedAutomatic, null);
  const newRequest = gate.begin({ replace: true });
  assert.equal(oldRequest.signal.aborted, true);
  let applied = 'none';
  let finishOld;
  let finishNew;
  const oldResponse = new Promise((resolve) => { finishOld = resolve; }).then((value) => { if (oldRequest.isCurrent()) applied = value; });
  const newResponse = new Promise((resolve) => { finishNew = resolve; }).then((value) => { if (newRequest.isCurrent()) applied = value; newRequest.finish(); });
  finishNew('new');
  await newResponse;
  finishOld('old');
  await oldResponse;
  assert.equal(applied, 'new');
});

test('Qamqor query failure leaves route creation independent and marks risk unavailable', async () => {
  const route = await Promise.resolve({ id: 'valhalla-route', geometry: line });
  const assessment = await loadOptionalRouteRisk(route, async () => { throw new Error('Qamqor/PostGIS unavailable'); }, (builtRoute) => ({ route: builtRoute, ...classifyRouteRiskData({ sources: [], records: [], queryFailed: true, now }) }));
  assert.equal(route.id, 'valhalla-route');
  assert.equal(assessment.route.id, 'valhalla-route');
  assert.equal(assessment.status, 'unavailable');
  assert.equal(canRankByRiskExposure([{ status: assessment.status, confidence: 'insufficient_data', sourceAgeDays: assessment.sourceAgeDays }]), false);
});

test('a recent stale Qamqor snapshot is labeled and rankable; expired data is not rankable', () => {
  const source = { record_count: 100, retrieved_at: now - 4 * 86400000, last_sync_status: 'failed' };
  const recent = classifyRouteRiskData({ sources: [source], records: [{}], riskConfidence: 'limited', now });
  assert.equal(recent.status, 'stale_snapshot');
  assert.equal(recent.sourceAgeDays, 4);
  assert.equal(canRankByRiskExposure([{ ...recent, confidence: 'limited' }]), true);

  const expired = classifyRouteRiskData({ sources: [{ ...source, retrieved_at: now - (MAX_RISK_SOURCE_AGE_DAYS + 1) * 86400000 }], records: [{}], riskConfidence: 'limited', now });
  assert.equal(expired.status, 'stale_snapshot');
  assert.equal(canRankByRiskExposure([{ ...expired, confidence: 'limited' }]), false);
});
