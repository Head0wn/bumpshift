import { defineTypes, MapSchema, Schema } from "@colyseus/schema";

export class PlayerState extends Schema {
  name = "Pilote";
  colorIndex = 0;
  ready = false;
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  steer = 0;
  driftCharge = 0;
  boostTime = 0;
  drifting = false;
  lap = 1;
  checkpoint = 0;
  progress = 0;
  finished = false;
  position = 1;
  finishPosition = 0;
  finishTimeMs = -1;
  lastProcessedInput = 0;
}

defineTypes(PlayerState, {
  name: "string",
  colorIndex: "number",
  ready: "boolean",
  x: "number",
  z: "number",
  heading: "number",
  speed: "number",
  steer: "number",
  driftCharge: "number",
  boostTime: "number",
  drifting: "boolean",
  lap: "number",
  checkpoint: "number",
  progress: "number",
  finished: "boolean",
  position: "number",
  finishPosition: "number",
  finishTimeMs: "number",
  lastProcessedInput: "number"
});

export class RaceState extends Schema {
  players = new MapSchema<PlayerState>();
  phase = "waiting";
  trackId = "aurora";
  serverTick = 0;
  phaseEndsAtTick = 0;
  raceStartedAtTick = 0;
  round = 1;
}

defineTypes(RaceState, {
  players: { map: PlayerState },
  phase: "string",
  trackId: "string",
  serverTick: "number",
  phaseEndsAtTick: "number",
  raceStartedAtTick: "number",
  round: "number"
});
