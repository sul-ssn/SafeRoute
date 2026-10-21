function distanceMeters(a, b) {
  const radians = Math.PI / 180;
  const deltaLat = (b[1] - a[1]) * radians;
  const deltaLon = (b[0] - a[0]) * radians;
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(deltaLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(h));
}

function cumulativeLengths(coordinates) {
  const lengths = [0];
  for (let index = 1; index < coordinates.length; index++) lengths.push(lengths[index - 1] + distanceMeters(coordinates[index - 1], coordinates[index]));
  return lengths;
}

function sampleLine(coordinates, spacingMeters) {
  if (coordinates.length < 2) return coordinates;
  const cumulative = cumulativeLengths(coordinates);
  const samples = [coordinates[0]];
  let segment = 1;
  for (let target = spacingMeters; target < cumulative.at(-1); target += spacingMeters) {
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment++;
    const start = cumulative[segment - 1];
    const fraction = (target - start) / Math.max(1e-6, cumulative[segment] - start);
    const a = coordinates[segment - 1];
    const b = coordinates[segment];
    samples.push([a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]);
  }
  samples.push(coordinates.at(-1));
  return samples;
}

function distanceToLine(point, coordinates) {
  const radians = Math.PI / 180;
  const latScale = 111320;
  const lonScale = latScale * Math.cos(point[1] * radians);
  let nearest = Infinity;
  for (let index = 1; index < coordinates.length; index++) {
    const a = [(coordinates[index - 1][0] - point[0]) * lonScale, (coordinates[index - 1][1] - point[1]) * latScale];
    const b = [(coordinates[index][0] - point[0]) * lonScale, (coordinates[index][1] - point[1]) * latScale];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    const fraction = lengthSquared ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / lengthSquared)) : 0;
    nearest = Math.min(nearest, Math.hypot(a[0] + fraction * dx, a[1] + fraction * dy));
  }
  return nearest;
}

export function routeDifferenceRatio(first, second, toleranceMeters = 40, spacingMeters = 50) {
  const firstLine = first?.geometry?.coordinates ?? first;
  const secondLine = second?.geometry?.coordinates ?? second;
  if (!Array.isArray(firstLine) || !Array.isArray(secondLine) || firstLine.length < 2 || secondLine.length < 2) return 1;
  const firstSamples = sampleLine(firstLine, spacingMeters);
  const secondSamples = sampleLine(secondLine, spacingMeters);
  const firstDifferent = firstSamples.filter((point) => distanceToLine(point, secondLine) > toleranceMeters).length / firstSamples.length;
  const secondDifferent = secondSamples.filter((point) => distanceToLine(point, firstLine) > toleranceMeters).length / secondSamples.length;
  return (firstDifferent + secondDifferent) / 2;
}

export function filterDistinctRoutes(routes, { toleranceMeters = 40, minimumDifference = 0.16 } = {}) {
  const accepted = [];
  for (const route of routes) {
    if (accepted.every((existing) => routeDifferenceRatio(existing, route, toleranceMeters) >= minimumDifference)) accepted.push(route);
  }
  return accepted;
}
