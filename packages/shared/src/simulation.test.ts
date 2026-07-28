import { describe, expect, it } from "vitest";
import {
  createSpawnState,
  FIXED_TIMESTEP,
  KART_TUNING,
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
});
