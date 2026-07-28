import type { KartInput, KartState, TrackId } from "./protocol.js";
import {
  CHECKPOINT_COUNT,
  DEFAULT_TRACK_ID,
  TOTAL_LAPS
} from "./protocol.js";
import { getTrackDefinition, projectToTrack } from "./track.js";

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

export const KART_COLLISION_RADIUS = 1.18;

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

export interface RaceProgress {
  lap: number;
  checkpoint: number;
  finished: boolean;
}

export function advanceRaceProgress(
  currentProgress: number,
  nextProgress: number,
  currentCheckpoint: number,
  currentLap: number,
  speed: number,
  alreadyFinished = false
): RaceProgress {
  if (alreadyFinished || speed <= 0) {
    return {
      lap: currentLap,
      checkpoint: currentCheckpoint,
      finished: alreadyFinished
    };
  }

  let lap = currentLap;
  let checkpoint = currentCheckpoint;
  const crossedStartLine = currentProgress > 0.84 && nextProgress < 0.16;

  if (crossedStartLine) {
    if (checkpoint >= CHECKPOINT_COUNT - 1) {
      lap += 1;
      checkpoint = 0;
    }
  } else if (checkpoint < CHECKPOINT_COUNT - 1) {
    const nextCheckpointProgress = (checkpoint + 1) / CHECKPOINT_COUNT;
    if (
      currentProgress < nextCheckpointProgress &&
      nextProgress >= nextCheckpointProgress
    ) {
      checkpoint += 1;
    }
  }

  return {
    lap,
    checkpoint,
    finished: lap > TOTAL_LAPS
  };
}

export function raceProgressScore(state: Readonly<KartState>): number {
  const normalizedProgress =
    state.checkpoint === 0 && state.progress > 0.8
      ? state.progress - 1
      : state.progress;
  return (state.lap - 1) + normalizedProgress;
}

const constrainKartToTrack = (
  state: KartState,
  trackId: TrackId
): KartState => {
  const track = getTrackDefinition(trackId);
  const projection = projectToTrack(state.x, state.z, trackId);
  const trackLimit = track.width * 0.5 - 0.7;

  if (projection.distance <= trackLimit) {
    return state;
  }

  const side = Math.sign(projection.signedDistance) || 1;
  return {
    ...state,
    x: projection.point.x + projection.normal.x * trackLimit * side,
    z: projection.point.z + projection.normal.z * trackLimit * side,
    speed: state.speed * KART_TUNING.boundarySpeedRetention
  };
};

export function resolveKartCollisions(
  sourceStates: readonly Readonly<KartState>[],
  trackId: TrackId = DEFAULT_TRACK_ID
): KartState[] {
  const states = sourceStates.map((state) => ({ ...state }));
  const minimumDistance = KART_COLLISION_RADIUS * 2;

  for (let pass = 0; pass < 2; pass += 1) {
    for (let firstIndex = 0; firstIndex < states.length; firstIndex += 1) {
      const first = states[firstIndex];
      if (!first || first.finished) {
        continue;
      }

      for (
        let secondIndex = firstIndex + 1;
        secondIndex < states.length;
        secondIndex += 1
      ) {
        const second = states[secondIndex];
        if (!second || second.finished) {
          continue;
        }

        const deltaX = second.x - first.x;
        const deltaZ = second.z - first.z;
        const distance = Math.hypot(deltaX, deltaZ);
        if (distance >= minimumDistance) {
          continue;
        }

        const normalX =
          distance > 0.0001
            ? deltaX / distance
            : Math.cos(first.heading);
        const normalZ =
          distance > 0.0001
            ? deltaZ / distance
            : -Math.sin(first.heading);
        const correction = (minimumDistance - distance + 0.002) * 0.5;

        first.x -= normalX * correction;
        first.z -= normalZ * correction;
        second.x += normalX * correction;
        second.z += normalZ * correction;

        if (pass > 0) {
          continue;
        }

        const firstVelocityX = Math.sin(first.heading) * first.speed;
        const firstVelocityZ = Math.cos(first.heading) * first.speed;
        const secondVelocityX = Math.sin(second.heading) * second.speed;
        const secondVelocityZ = Math.cos(second.heading) * second.speed;
        const closingSpeed =
          (firstVelocityX - secondVelocityX) * normalX +
          (firstVelocityZ - secondVelocityZ) * normalZ;

        if (closingSpeed <= 0) {
          continue;
        }

        const impulse = closingSpeed * 0.46;
        const nextFirstVelocityX = firstVelocityX - normalX * impulse;
        const nextFirstVelocityZ = firstVelocityZ - normalZ * impulse;
        const nextSecondVelocityX = secondVelocityX + normalX * impulse;
        const nextSecondVelocityZ = secondVelocityZ + normalZ * impulse;
        const firstForwardX = Math.sin(first.heading);
        const firstForwardZ = Math.cos(first.heading);
        const secondForwardX = Math.sin(second.heading);
        const secondForwardZ = Math.cos(second.heading);

        first.speed = clamp(
          nextFirstVelocityX * firstForwardX +
            nextFirstVelocityZ * firstForwardZ,
          KART_TUNING.maxReverseSpeed,
          KART_TUNING.boostTopSpeed
        );
        second.speed = clamp(
          nextSecondVelocityX * secondForwardX +
            nextSecondVelocityZ * secondForwardZ,
          KART_TUNING.maxReverseSpeed,
          KART_TUNING.boostTopSpeed
        );

        const firstSide =
          firstForwardX * normalZ - firstForwardZ * normalX;
        const secondSide =
          secondForwardX * -normalZ - secondForwardZ * -normalX;
        first.heading += clamp(firstSide * closingSpeed * 0.012, -0.2, 0.2);
        second.heading += clamp(
          secondSide * closingSpeed * 0.012,
          -0.2,
          0.2
        );
      }
    }
  }

  return states.map((state) => constrainKartToTrack(state, trackId));
}

export function stepKart(
  current: Readonly<KartState>,
  input: Readonly<KartInput>,
  deltaSeconds: number,
  trackId: TrackId = DEFAULT_TRACK_ID
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

  const track = getTrackDefinition(trackId);
  let projection = projectToTrack(x, z, trackId);
  const trackLimit = track.width * 0.5 - 0.7;

  if (projection.distance > trackLimit) {
    const side = Math.sign(projection.signedDistance) || 1;
    x = projection.point.x + projection.normal.x * trackLimit * side;
    z = projection.point.z + projection.normal.z * trackLimit * side;
    speed *= KART_TUNING.boundarySpeedRetention;
    projection = projectToTrack(x, z, trackId);
  }

  const raceProgress = advanceRaceProgress(
    current.progress,
    projection.progress,
    current.checkpoint,
    current.lap,
    speed,
    current.finished
  );

  return {
    x,
    z,
    heading,
    speed,
    steer: moveToward(current.steer, input.steer, dt * 7.5),
    driftCharge,
    boostTime,
    drifting,
    lap: raceProgress.lap,
    checkpoint: raceProgress.checkpoint,
    progress: projection.progress,
    finished: raceProgress.finished,
    lastProcessedInput: input.sequence
  };
}
