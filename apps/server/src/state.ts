import { defineTypes, MapSchema, Schema } from "@colyseus/schema";

export class PlayerState extends Schema {
  name = "Pilote";
  colorIndex = 0;
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  steer = 0;
  driftCharge = 0;
  boostTime = 0;
  drifting = false;
  lap = 1;
  progress = 0;
  finished = false;
  lastProcessedInput = 0;
}

defineTypes(PlayerState, {
  name: "string",
  colorIndex: "number",
  x: "number",
  z: "number",
  heading: "number",
  speed: "number",
  steer: "number",
  driftCharge: "number",
  boostTime: "number",
  drifting: "boolean",
  lap: "number",
  progress: "number",
  finished: "boolean",
  lastProcessedInput: "number"
});

export class RaceState extends Schema {
  players = new MapSchema<PlayerState>();
  phase = "race";
  serverTick = 0;
}

defineTypes(RaceState, {
  players: { map: PlayerState },
  phase: "string",
  serverTick: "number"
});

