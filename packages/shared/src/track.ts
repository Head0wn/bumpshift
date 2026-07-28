import type { KartState } from "./protocol.js";

export interface Vec2 {
  x: number;
  z: number;
}

export interface TrackProjection {
  point: Vec2;
  tangent: Vec2;
  normal: Vec2;
  signedDistance: number;
  distance: number;
  progress: number;
}

export const TRACK_NAME = "Circuit Aurore";
export const TRACK_WIDTH = 15;
export const TRACK_SAMPLES_PER_SEGMENT = 14;

export const TRACK_CONTROL_POINTS: readonly Vec2[] = Object.freeze([
  { x: 0, z: -46 },
  { x: 34, z: -48 },
  { x: 59, z: -31 },
  { x: 66, z: -5 },
  { x: 55, z: 20 },
  { x: 31, z: 31 },
  { x: 8, z: 28 },
  { x: -10, z: 43 },
  { x: -39, z: 42 },
  { x: -63, z: 24 },
  { x: -67, z: -7 },
  { x: -50, z: -34 },
  { x: -23, z: -45 }
]);

const getPoint = (points: readonly Vec2[], index: number): Vec2 => {
  const point = points[(index + points.length) % points.length];
  if (!point) {
    throw new Error("Le circuit doit contenir au moins un point.");
  }
  return point;
};

function catmullRom(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  t: number
): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    z:
      0.5 *
      (2 * p1.z +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
  };
}

export function sampleClosedTrack(
  points: readonly Vec2[],
  samplesPerSegment = TRACK_SAMPLES_PER_SEGMENT
): Vec2[] {
  if (points.length < 4) {
    throw new Error("Un circuit fermé nécessite au moins quatre points.");
  }

  const sampled: Vec2[] = [];

  for (let segment = 0; segment < points.length; segment += 1) {
    const p0 = getPoint(points, segment - 1);
    const p1 = getPoint(points, segment);
    const p2 = getPoint(points, segment + 1);
    const p3 = getPoint(points, segment + 2);

    for (let sample = 0; sample < samplesPerSegment; sample += 1) {
      sampled.push(catmullRom(p0, p1, p2, p3, sample / samplesPerSegment));
    }
  }

  return sampled;
}

export const TRACK_CENTERLINE: readonly Vec2[] = Object.freeze(
  sampleClosedTrack(TRACK_CONTROL_POINTS)
);

export function projectToTrack(x: number, z: number): TrackProjection {
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  let bestPoint: Vec2 = TRACK_CENTERLINE[0] ?? { x: 0, z: 0 };
  let bestTangent: Vec2 = { x: 0, z: 1 };
  let bestNormal: Vec2 = { x: -1, z: 0 };
  let bestSignedDistance = 0;
  let bestProgress = 0;

  for (let index = 0; index < TRACK_CENTERLINE.length; index += 1) {
    const start = getPoint(TRACK_CENTERLINE, index);
    const end = getPoint(TRACK_CENTERLINE, index + 1);
    const segmentX = end.x - start.x;
    const segmentZ = end.z - start.z;
    const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;

    if (lengthSquared <= Number.EPSILON) {
      continue;
    }

    const localX = x - start.x;
    const localZ = z - start.z;
    const t = Math.min(
      1,
      Math.max(0, (localX * segmentX + localZ * segmentZ) / lengthSquared)
    );
    const point = {
      x: start.x + segmentX * t,
      z: start.z + segmentZ * t
    };
    const deltaX = x - point.x;
    const deltaZ = z - point.z;
    const distanceSquared = deltaX * deltaX + deltaZ * deltaZ;

    if (distanceSquared >= bestDistanceSquared) {
      continue;
    }

    const inverseLength = 1 / Math.sqrt(lengthSquared);
    const tangent = {
      x: segmentX * inverseLength,
      z: segmentZ * inverseLength
    };
    const normal = {
      x: -tangent.z,
      z: tangent.x
    };

    bestDistanceSquared = distanceSquared;
    bestPoint = point;
    bestTangent = tangent;
    bestNormal = normal;
    bestSignedDistance = deltaX * normal.x + deltaZ * normal.z;
    bestProgress = (index + t) / TRACK_CENTERLINE.length;
  }

  return {
    point: bestPoint,
    tangent: bestTangent,
    normal: bestNormal,
    signedDistance: bestSignedDistance,
    distance: Math.sqrt(bestDistanceSquared),
    progress: bestProgress
  };
}

export function createSpawnState(slot: number): KartState {
  const row = Math.floor(slot / 2);
  const lane = slot % 2 === 0 ? -1 : 1;
  const sampleIndex =
    (2 - row * 3 + TRACK_CENTERLINE.length) % TRACK_CENTERLINE.length;
  const point = getPoint(TRACK_CENTERLINE, sampleIndex);
  const next = getPoint(TRACK_CENTERLINE, sampleIndex + 1);
  const deltaX = next.x - point.x;
  const deltaZ = next.z - point.z;
  const inverseLength = 1 / Math.max(Math.hypot(deltaX, deltaZ), 0.0001);
  const tangent = { x: deltaX * inverseLength, z: deltaZ * inverseLength };
  const normal = { x: -tangent.z, z: tangent.x };
  const x = point.x + normal.x * lane * 2.2;
  const z = point.z + normal.z * lane * 2.2;
  const projection = projectToTrack(x, z);

  return {
    x,
    z,
    heading: Math.atan2(tangent.x, tangent.z),
    speed: 0,
    steer: 0,
    driftCharge: 0,
    boostTime: 0,
    drifting: false,
    lap: 1,
    progress: projection.progress,
    finished: false,
    lastProcessedInput: 0
  };
}

