import type { KartInput, KartState } from "./protocol.js";
import { TOTAL_LAPS } from "./protocol.js";
import { projectToTrack, TRACK_WIDTH } from "./track.js";

export const KART_TUNING = Object.freeze({
  acceleration: 20,
  reverseAcceleration: 12,
  brakePower: 34,
  coastDrag: 7,
  aerodynamicDrag: 0.008,
  maxForwardSpeed: 34,
  maxReverseSpeed: -8,
  turnRate: 1.72,
  driftTurnMultiplier: 1.32,
  driftMinimumSpeed: 7,
  driftMinimumSteer: 0.22,
  boostAcceleration: 21,
  boostTopSpeed: 43,
  boundarySpeedRetention: 0.78
});

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const moveToward = (value: number, target: number, amount: number): number => {
  if (value < target) {
    return Math.min(value + amount, target);
  }
  return Math.max(value - amount, target);
};

const miniTurboDuration = (charge: number): number => {
  if (charge >= 1.25) {
    return 1.25;
  }
  if (charge >= 0.72) {
    return 0.88;
  }
  if (charge >= 0.32) {
    return 0.5;
  }
  return 0;
};

export function stepKart(
  current: Readonly<KartState>,
  input: Readonly<KartInput>,
  deltaSeconds: number
): KartState {
  const dt = clamp(deltaSeconds, 0, 0.05);
  let speed = current.speed;
  let heading = current.heading;
  let driftCharge = current.driftCharge;
  let boostTime = Math.max(0, current.boostTime - dt);
  let x = current.x;
  let z = current.z;

  if (input.throttle > 0) {
    speed += KART_TUNING.acceleration * input.throttle * dt;
  }

  if (input.brake > 0) {
    if (speed > 0.4) {
      speed -= KART_TUNING.brakePower * input.brake * dt;
    } else {
      speed -= KART_TUNING.reverseAcceleration * input.brake * dt;
    }
  }

  if (input.throttle === 0 && input.brake === 0) {
    speed = moveToward(speed, 0, KART_TUNING.coastDrag * dt);
  }

  speed -=
    Math.sign(speed) *
    KART_TUNING.aerodynamicDrag *
    speed *
    speed *
    dt;

  const speedRatio = clamp(
    Math.abs(speed) / KART_TUNING.maxForwardSpeed,
    0,
    1
  );
  const drifting =
    input.drift &&
    Math.abs(speed) >= KART_TUNING.driftMinimumSpeed &&
    Math.abs(input.steer) >= KART_TUNING.driftMinimumSteer;

  if (drifting) {
    driftCharge = Math.min(
      1.6,
      driftCharge +
        dt * (0.55 + Math.abs(input.steer) * 0.72 + speedRatio * 0.28)
    );
  } else if (current.drifting) {
    boostTime = Math.max(boostTime, miniTurboDuration(driftCharge));
    driftCharge = 0;
  } else {
    driftCharge = moveToward(driftCharge, 0, dt * 0.5);
  }

  if (boostTime > 0) {
    speed += KART_TUNING.boostAcceleration * dt;
  }

  const topSpeed =
    boostTime > 0
      ? KART_TUNING.boostTopSpeed
      : KART_TUNING.maxForwardSpeed;
  speed = clamp(
    speed,
    KART_TUNING.maxReverseSpeed,
    topSpeed
  );

  const direction = speed < -0.05 ? -1 : 1;
  const steeringAuthority = 0.18 + speedRatio * 0.82;
  heading +=
    input.steer *
    KART_TUNING.turnRate *
    steeringAuthority *
    (drifting ? KART_TUNING.driftTurnMultiplier : 1) *
    direction *
    dt;

  x += Math.sin(heading) * speed * dt;
  z += Math.cos(heading) * speed * dt;

  let projection = projectToTrack(x, z);
  const trackLimit = TRACK_WIDTH * 0.5 - 0.7;

  if (projection.distance > trackLimit) {
    const side = Math.sign(projection.signedDistance) || 1;
    x = projection.point.x + projection.normal.x * trackLimit * side;
    z = projection.point.z + projection.normal.z * trackLimit * side;
    speed *= KART_TUNING.boundarySpeedRetention;
    projection = projectToTrack(x, z);
  }

  let lap = current.lap;
  if (
    current.progress > 0.84 &&
    projection.progress < 0.16 &&
    speed > 0
  ) {
    lap += 1;
  } else if (
    current.progress < 0.16 &&
    projection.progress > 0.84 &&
    speed < 0
  ) {
    lap = Math.max(1, lap - 1);
  }

  return {
    x,
    z,
    heading,
    speed,
    steer: moveToward(current.steer, input.steer, dt * 7.5),
    driftCharge,
    boostTime,
    drifting,
    lap,
    progress: projection.progress,
    finished: current.finished || lap > TOTAL_LAPS,
    lastProcessedInput: input.sequence
  };
}

