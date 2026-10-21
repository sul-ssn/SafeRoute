export function pointDistanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(h));
}

export function routeCumulativeMeters(coordinates) {
  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index++) {
    const [lonA, latA] = coordinates[index - 1];
    const [lonB, latB] = coordinates[index];
    cumulative.push(cumulative[index - 1] + pointDistanceMeters({ lat: latA, lon: lonA }, { lat: latB, lon: lonB }));
  }
  return cumulative;
}

function bearingDifference(a, b) {
  const difference = Math.abs(((a - b + 540) % 360) - 180);
  return difference;
}

export function matchRoutePosition(point, coordinates, previous, cumulative, maxAdvance, motion = {}) {
  const latScale = 111320;
  const lonScale = 111320 * Math.cos(point.lat * Math.PI / 180);
  let best = { segmentIndex: 0, distance_m: Infinity, progress_m: 0, score: Infinity };
  let fallback = null;
  const first = previous ? Math.max(0, previous.segmentIndex - 2) : 0;
  const last = previous
    ? Math.min(coordinates.length - 2, previous.segmentIndex + Math.max(12, Math.ceil(maxAdvance / 3)))
    : coordinates.length - 2;
  const elapsed = Math.max(0, Number(motion.elapsedSeconds ?? 0));
  const speed = Math.max(0, Number(motion.speedMps ?? 0));
  const predictedProgress = previous ? previous.progress_m + Math.min(maxAdvance, speed * elapsed) : 0;

  for (let index = first; index <= last; index++) {
    const [lonA, latA] = coordinates[index];
    const [lonB, latB] = coordinates[index + 1];
    const ax = (lonA - point.lon) * lonScale;
    const ay = (latA - point.lat) * latScale;
    const bx = (lonB - point.lon) * lonScale;
    const by = (latB - point.lat) * latScale;
    const dx = bx - ax;
    const dy = by - ay;
    const denominator = dx * dx + dy * dy;
    const fraction = denominator ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0;
    const distance = Math.hypot(ax + fraction * dx, ay + fraction * dy);
    const progress = cumulative[index] + (cumulative[index + 1] - cumulative[index]) * fraction;
    const routeBearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    const directionDifference = Number.isFinite(motion.heading) && speed >= 2
      ? bearingDifference(routeBearing, motion.heading)
      : 0;
    const candidate = { segmentIndex: index, distance_m: distance, progress_m: Math.max(previous?.progress_m ?? 0, progress), directionDifference };
    const progressPenalty = previous ? Math.min(100, Math.abs(progress - predictedProgress) * 0.3) : 0;
    const headingPenalty = directionDifference > 120 ? (directionDifference - 120) * 0.8 : directionDifference * 0.08;
    const score = distance + progressPenalty + headingPenalty;
    if (!fallback || score < fallback.score) {
      fallback = { ...candidate, progress_m: previous ? Math.max(previous.progress_m, Math.min(progress, previous.progress_m + maxAdvance)) : progress, score };
    }
    if (previous && (progress < previous.progress_m - 25 || progress > previous.progress_m + maxAdvance)) continue;
    if (score < best.score) best = { ...candidate, score };
  }

  if (Number.isFinite(best.distance_m)) return best;
  return fallback ?? best;
}

export function validGpsPosition(position, now = Date.now()) {
  const age = now - position.timestamp;
  return Number.isFinite(position.coords.latitude)
    && Number.isFinite(position.coords.longitude)
    && Number.isFinite(position.coords.accuracy)
    && position.coords.accuracy <= 50
    && age >= -5000
    && age <= 15000;
}

export function navigationContextIsCurrent(captured, active) {
  return captured.routeVersion === active.routeVersion && captured.session === active.session;
}

export function plausibleGpsTransition(previous, next, maxSpeed) {
  if (!previous) return true;
  const elapsed = (next.timestamp - previous.timestamp) / 1000;
  if (elapsed <= 0) return false;
  const uncertaintyAdjustedDistance = Math.max(0, pointDistanceMeters(previous.point, next.point) - previous.accuracy - next.accuracy);
  return uncertaintyAdjustedDistance / elapsed <= maxSpeed;
}

export function offRouteThreshold(accuracy) {
  return Math.max(20, Math.min(50, accuracy * 1.5 + 8));
}

export function updateOffRouteFixCount(previousCount, distance, threshold, confirmations = 3) {
  const count = distance > threshold ? previousCount + 1 : 0;
  return { count, confirmed: count >= confirmations };
}

export function advanceManeuverOneStep(current, maneuvers, previousProgress, progress, cumulative, lastAdvanceProgress = 0, margin = 18) {
  if (current >= maneuvers.length - 1) return current;
  const endIndex = Math.max(0, Math.min(cumulative.length - 1, maneuvers[current].end_index));
  const threshold = cumulative[endIndex] + margin;
  const crossed = previousProgress < threshold && progress >= threshold;
  const movedSinceLastAdvance = current > 0 && progress - lastAdvanceProgress >= 8;
  return progress >= threshold && (crossed || movedSinceLastAdvance) ? current + 1 : current;
}

export function updateArrivalConfirmation(previousCount, accuracy, speed, destinationDistance) {
  const radius = Math.min(35, Math.max(20, accuracy * 1.2));
  const stopped = speed == null || speed <= 1.5;
  const confirmed = accuracy <= 25 && destinationDistance <= radius && stopped;
  const count = confirmed ? previousCount + 1 : 0;
  return { count, arrived: count >= 3 };
}

export class LatestRouteRequestGate {
  #sequence = 0;
  #active = null;

  begin({ replace = false } = {}) {
    if (this.#active && !replace) return null;
    this.#active?.controller.abort();
    const id = ++this.#sequence;
    const controller = new AbortController();
    this.#active = { id, controller };
    return {
      id,
      signal: controller.signal,
      isCurrent: () => this.#active?.id === id && !controller.signal.aborted,
      finish: () => {
        if (this.#active?.id !== id) return false;
        this.#active = null;
        return true;
      },
    };
  }

  cancel() {
    this.#sequence++;
    this.#active?.controller.abort();
    this.#active = null;
  }
}
