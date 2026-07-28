import {
  DEFAULT_TRACK_ID,
  sanitizeTrackId,
  type KartState,
  type TrackId
} from "./protocol.js";

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

export interface ElevationPoint {
  progress: number;
  height: number;
}

export interface TrackDefinition {
  id: TrackId;
  name: string;
  location: string;
  description: string;
  difficulty: "Accessible" | "Technique";
  width: number;
  samplesPerSegment: number;
  controlPoints: readonly Vec2[];
  elevationProfile: readonly ElevationPoint[];
  centerline: readonly Vec2[];
}

export const TRACK_SAMPLES_PER_SEGMENT = 14;

const AURORA_CONTROL_POINTS: readonly Vec2[] = Object.freeze([
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

// Une interprétation arcade d'une principauté portuaire : montée vers les
// hauteurs, épingle serrée, tunnel rapide, chicane du port et dernier virage
// autour des terrasses. Le tracé est original mais son rythme est familier.
const RIVIERA_ROYALE_CONTROL_POINTS: readonly Vec2[] = Object.freeze([
  { x: -45, z: -55 },
  { x: -28, z: -45 },
  { x: -5, z: -43 },
  { x: 22, z: -43 },
  { x: 40, z: -38 },
  { x: 46, z: -27 },
  { x: 36, z: -17 },
  { x: 18, z: -10 },
  { x: -5, z: -10 },
  { x: -35, z: -4 },
  { x: -62, z: 7 },
  { x: -72, z: 25 },
  { x: -64, z: 47 },
  { x: -42, z: 62 },
  { x: -14, z: 65 },
  { x: 12, z: 57 },
  { x: 27, z: 45 },
  { x: 20, z: 35 },
  { x: 5, z: 33 },
  { x: -13, z: 41 },
  { x: -31, z: 39 },
  { x: -47, z: 29 },
  { x: -47, z: 17 },
  { x: -36, z: 9 },
  { x: -20, z: 5 },
  { x: -5, z: 10 },
  { x: 13, z: 16 },
  { x: 33, z: 18 },
  { x: 51, z: 13 },
  { x: 68, z: 5 },
  { x: 70, z: -8 },
  { x: 64, z: -18 },
  { x: 72, z: -27 },
  { x: 66, z: -39 },
  { x: 60, z: -52 },
  { x: 48, z: -62 },
  { x: 25, z: -65 },
  { x: -2, z: -64 },
  { x: -30, z: -61 }
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

const defineTrack = (
  definition: Omit<TrackDefinition, "centerline">
): TrackDefinition =>
  Object.freeze({
    ...definition,
    centerline: Object.freeze(
      sampleClosedTrack(
        definition.controlPoints,
        definition.samplesPerSegment
      )
    )
  });

export const TRACKS: readonly TrackDefinition[] = Object.freeze([
  defineTrack({
    id: "aurora",
    name: "Circuit Aurore",
    location: "Forêt boréale",
    description: "Rapide, large et idéal pour maîtriser le drift.",
    difficulty: "Accessible",
    width: 15,
    samplesPerSegment: 14,
    elevationProfile: [
      { progress: 0, height: 0 },
      { progress: 0.18, height: 1.4 },
      { progress: 0.38, height: 0.4 },
      { progress: 0.62, height: 2.2 },
      { progress: 0.82, height: 0.8 },
      { progress: 1, height: 0 }
    ],
    controlPoints: AURORA_CONTROL_POINTS
  }),
  defineTrack({
    id: "riviera-royale",
    name: "Riviera Royale",
    location: "Principauté solaire",
    description: "Épingles, tunnel et barrières au bord du port.",
    difficulty: "Technique",
    width: 9.4,
    samplesPerSegment: 10,
    elevationProfile: [
      { progress: 0, height: 0 },
      { progress: 0.1, height: 0.8 },
      { progress: 0.2, height: 5.2 },
      { progress: 0.32, height: 10.5 },
      { progress: 0.43, height: 12.4 },
      { progress: 0.54, height: 8.8 },
      { progress: 0.64, height: 4.6 },
      { progress: 0.74, height: 1.2 },
      { progress: 0.88, height: 0 },
      { progress: 1, height: 0 }
    ],
    controlPoints: RIVIERA_ROYALE_CONTROL_POINTS
  })
]);

const TRACK_BY_ID = new Map(
  TRACKS.map((track) => [track.id, track] as const)
);

export function getTrackDefinition(value: TrackId | string): TrackDefinition {
  return (
    TRACK_BY_ID.get(sanitizeTrackId(value)) ??
    TRACK_BY_ID.get(DEFAULT_TRACK_ID) ??
    TRACKS[0]
  ) as TrackDefinition;
}

export function trackLength(trackId: TrackId = DEFAULT_TRACK_ID): number {
  const centerline = getTrackDefinition(trackId).centerline;
  let length = 0;
  for (let index = 0; index < centerline.length; index += 1) {
    const start = getPoint(centerline, index);
    const end = getPoint(centerline, index + 1);
    length += Math.hypot(end.x - start.x, end.z - start.z);
  }
  return length;
}

export function trackHeightAtProgress(
  trackId: TrackId,
  progress: number
): number {
  const profile = getTrackDefinition(trackId).elevationProfile;
  const normalized = ((progress % 1) + 1) % 1;

  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1];
    const next = profile[index];
    if (!previous || !next || normalized > next.progress) {
      continue;
    }

    const span = Math.max(Number.EPSILON, next.progress - previous.progress);
    const amount = (normalized - previous.progress) / span;
    const eased = amount * amount * (3 - 2 * amount);
    return previous.height + (next.height - previous.height) * eased;
  }

  return profile.at(-1)?.height ?? 0;
}

export function projectToTrack(
  x: number,
  z: number,
  trackId: TrackId = DEFAULT_TRACK_ID
): TrackProjection {
  const centerline = getTrackDefinition(trackId).centerline;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  let bestPoint: Vec2 = centerline[0] ?? { x: 0, z: 0 };
  let bestTangent: Vec2 = { x: 0, z: 1 };
  let bestNormal: Vec2 = { x: -1, z: 0 };
  let bestSignedDistance = 0;
  let bestProgress = 0;

  for (let index = 0; index < centerline.length; index += 1) {
    const start = getPoint(centerline, index);
    const end = getPoint(centerline, index + 1);
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
    bestProgress = (index + t) / centerline.length;
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

export function createSpawnState(
  slot: number,
  trackId: TrackId = DEFAULT_TRACK_ID
): KartState {
  const centerline = getTrackDefinition(trackId).centerline;
  const row = Math.floor(slot / 2);
  const lane = slot % 2 === 0 ? -1 : 1;
  const sampleIndex =
    (2 - row * 3 + centerline.length) % centerline.length;
  const point = getPoint(centerline, sampleIndex);
  const next = getPoint(centerline, sampleIndex + 1);
  const deltaX = next.x - point.x;
  const deltaZ = next.z - point.z;
  const inverseLength = 1 / Math.max(Math.hypot(deltaX, deltaZ), 0.0001);
  const tangent = { x: deltaX * inverseLength, z: deltaZ * inverseLength };
  const normal = { x: -tangent.z, z: tangent.x };
  const laneSpacing = trackId === "riviera-royale" ? 1.82 : 2.2;
  const x = point.x + normal.x * lane * laneSpacing;
  const z = point.z + normal.z * lane * laneSpacing;
  const projection = projectToTrack(x, z, trackId);

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
    checkpoint: 0,
    progress: projection.progress,
    finished: false,
    lastProcessedInput: 0
  };
}

// Alias conservés pour les consommateurs du premier jalon.
export const TRACK_NAME = getTrackDefinition(DEFAULT_TRACK_ID).name;
export const TRACK_WIDTH = getTrackDefinition(DEFAULT_TRACK_ID).width;
export const TRACK_CONTROL_POINTS =
  getTrackDefinition(DEFAULT_TRACK_ID).controlPoints;
export const TRACK_CENTERLINE =
  getTrackDefinition(DEFAULT_TRACK_ID).centerline;
