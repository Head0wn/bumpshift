export const MAX_PLAYERS = 12;
export const TOTAL_LAPS = 3;
export const SIMULATION_HZ = 60;
export const FIXED_TIMESTEP = 1 / SIMULATION_HZ;
export const CHECKPOINT_COUNT = 8;
export const COUNTDOWN_TICKS = SIMULATION_HZ * 3;
export const FINISH_GRACE_TICKS = SIMULATION_HZ * 30;
export const RESULTS_TICKS = SIMULATION_HZ * 10;

export const RACE_PHASES = [
  "waiting",
  "countdown",
  "racing",
  "results"
] as const;

export type RacePhase = (typeof RACE_PHASES)[number];

export interface RaceSnapshot {
  phase: RacePhase;
  serverTick: number;
  phaseEndsAtTick: number;
  raceStartedAtTick: number;
  round: number;
}

export interface KartInput {
  sequence: number;
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
}

export interface KartState {
  x: number;
  z: number;
  heading: number;
  speed: number;
  steer: number;
  driftCharge: number;
  boostTime: number;
  drifting: boolean;
  lap: number;
  checkpoint: number;
  progress: number;
  finished: boolean;
  lastProcessedInput: number;
}

export interface PlayerSnapshot extends KartState {
  id: string;
  name: string;
  colorIndex: number;
  ready: boolean;
  position: number;
  finishPosition: number;
  finishTimeMs: number;
}

export const NEUTRAL_INPUT: Readonly<KartInput> = Object.freeze({
  sequence: 0,
  throttle: 0,
  brake: 0,
  steer: 0,
  drift: false
});

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const finiteNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export function sanitizeKartInput(value: unknown): KartInput | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Partial<Record<keyof KartInput, unknown>>;
  const sequence = Math.floor(finiteNumber(candidate.sequence, -1));

  if (sequence < 0 || sequence > Number.MAX_SAFE_INTEGER) {
    return null;
  }

  return {
    sequence,
    throttle: clamp(finiteNumber(candidate.throttle, 0), 0, 1),
    brake: clamp(finiteNumber(candidate.brake, 0), 0, 1),
    steer: clamp(finiteNumber(candidate.steer, 0), -1, 1),
    drift: candidate.drift === true
  };
}

export function sanitizePlayerName(value: unknown): string {
  if (typeof value !== "string") {
    return "Pilote";
  }

  const cleaned = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);

  return cleaned || "Pilote";
}

export function sanitizeRacePhase(value: unknown): RacePhase {
  return typeof value === "string" &&
    (RACE_PHASES as readonly string[]).includes(value)
    ? (value as RacePhase)
    : "waiting";
}
