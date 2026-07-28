import { describe, expect, it } from "vitest";
import {
  advanceRaceProgress,
  CHECKPOINT_COUNT,
  createSpawnState,
  FIXED_TIMESTEP,
  KART_COLLISION_RADIUS,
  KART_TUNING,
  resolveKartCollisions,
  sanitizeKartInput,
  stepKart,
  TRACK_WIDTH
} from "./index.js";

describe("simulation de kart", () => {
  it("accélère sans dépasser la vitesse maximale normale", () => {
    const spawn = createSpawnState(0);
    let state = spawn;

    for (let tick = 0; tick < 60 * 10; tick += 1) {
      state = stepKart(
        {
          ...state,
          x: spawn.x,
          z: spawn.z,
          heading: spawn.heading
        },
        {
          sequence: tick + 1,
          throttle: 1,
          brake: 0,
          steer: 0,
          drift: false
        },
        FIXED_TIMESTEP
      );
    }

    expect(state.speed).toBeGreaterThan(20);
    expect(state.speed).toBeLessThanOrEqual(KART_TUNING.maxForwardSpeed);
  });

  it("transforme un dérapage chargé en mini-turbo", () => {
    const spawn = createSpawnState(0);
    let state = {
      ...spawn,
      speed: 20
    };

    for (let tick = 0; tick < 75; tick += 1) {
      state = stepKart(
        {
          ...state,
          x: spawn.x,
          z: spawn.z,
          heading: spawn.heading,
          speed: Math.max(state.speed, 20)
        },
        {
          sequence: tick + 1,
          throttle: 1,
          brake: 0,
          steer: 1,
          drift: true
        },
        FIXED_TIMESTEP
      );
    }

    const released = stepKart(
      state,
      {
        sequence: 76,
        throttle: 1,
        brake: 0,
        steer: 0,
        drift: false
      },
      FIXED_TIMESTEP
    );

    expect(released.boostTime).toBeGreaterThan(0.45);
    expect(released.driftCharge).toBe(0);
  });

  it("rejette les positions au-delà des limites du circuit", () => {
    const spawn = createSpawnState(0);
    const state = stepKart(
      {
        ...spawn,
        x: spawn.x + 500,
        z: spawn.z + 500,
        speed: 20
      },
      {
        sequence: 1,
        throttle: 0,
        brake: 0,
        steer: 0,
        drift: false
      },
      FIXED_TIMESTEP
    );

    expect(Math.hypot(state.x - spawn.x, state.z - spawn.z)).toBeLessThan(500);
    expect(TRACK_WIDTH).toBeGreaterThan(0);
  });

  it("normalise les entrées venant du réseau", () => {
    expect(
      sanitizeKartInput({
        sequence: 12.8,
        throttle: 9,
        brake: -2,
        steer: -4,
        drift: "oui"
      })
    ).toEqual({
      sequence: 12,
      throttle: 1,
      brake: 0,
      steer: -1,
      drift: false
    });
  });

  it("refuse un tour si les checkpoints n'ont pas été validés", () => {
    const progress = advanceRaceProgress(0.92, 0.04, 2, 1, 18);

    expect(progress.lap).toBe(1);
    expect(progress.checkpoint).toBe(2);
    expect(progress.finished).toBe(false);
  });

  it("valide les checkpoints dans l'ordre avant de compter un tour", () => {
    let checkpoint = 0;

    for (let index = 1; index < CHECKPOINT_COUNT; index += 1) {
      const threshold = index / CHECKPOINT_COUNT;
      const progress = advanceRaceProgress(
        threshold - 0.01,
        threshold + 0.01,
        checkpoint,
        1,
        20
      );
      checkpoint = progress.checkpoint;
    }

    const completed = advanceRaceProgress(0.95, 0.03, checkpoint, 1, 20);
    expect(checkpoint).toBe(CHECKPOINT_COUNT - 1);
    expect(completed.lap).toBe(2);
    expect(completed.checkpoint).toBe(0);
  });

  it("termine la course uniquement après les trois tours complets", () => {
    let lap = 1;
    let finished = false;

    for (let completedLaps = 0; completedLaps < 3; completedLaps += 1) {
      const progress = advanceRaceProgress(
        0.95,
        0.03,
        CHECKPOINT_COUNT - 1,
        lap,
        24,
        finished
      );
      lap = progress.lap;
      finished = progress.finished;
    }

    expect(lap).toBe(4);
    expect(finished).toBe(true);
  });

  it("sépare deux karts et transfère une partie de leur vitesse", () => {
    const spawn = createSpawnState(0);
    const first = {
      ...spawn,
      x: 0,
      z: -46,
      heading: Math.PI / 2,
      speed: 24
    };
    const second = {
      ...spawn,
      x: 1.4,
      z: -46,
      heading: Math.PI / 2,
      speed: 4
    };

    const [resolvedFirst, resolvedSecond] = resolveKartCollisions([
      first,
      second
    ]);

    expect(resolvedFirst).toBeDefined();
    expect(resolvedSecond).toBeDefined();
    expect(
      Math.hypot(
        (resolvedSecond?.x ?? 0) - (resolvedFirst?.x ?? 0),
        (resolvedSecond?.z ?? 0) - (resolvedFirst?.z ?? 0)
      )
    ).toBeGreaterThanOrEqual(KART_COLLISION_RADIUS * 2 - 0.01);
    expect(resolvedFirst?.speed ?? 99).toBeLessThan(first.speed);
    expect(resolvedSecond?.speed ?? 0).toBeGreaterThan(second.speed);
  });
});
