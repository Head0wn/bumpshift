import {
  createSpawnState,
  FIXED_TIMESTEP,
  MAX_PLAYERS,
  NEUTRAL_INPUT,
  sanitizeKartInput,
  sanitizePlayerName,
  stepKart,
  type KartInput,
  type KartState
} from "@bumpshift/shared";
import { Room, type Client } from "@colyseus/core";
import { PlayerState, RaceState } from "./state.js";

interface PlayerRuntime {
  heldInput: KartInput;
  inputQueue: KartInput[];
  lastReceivedSequence: number;
}

const toKartState = (player: PlayerState): KartState => ({
  x: player.x,
  z: player.z,
  heading: player.heading,
  speed: player.speed,
  steer: player.steer,
  driftCharge: player.driftCharge,
  boostTime: player.boostTime,
  drifting: player.drifting,
  lap: player.lap,
  progress: player.progress,
  finished: player.finished,
  lastProcessedInput: player.lastProcessedInput
});

const applyKartState = (player: PlayerState, state: KartState): void => {
  player.x = state.x;
  player.z = state.z;
  player.heading = state.heading;
  player.speed = state.speed;
  player.steer = state.steer;
  player.driftCharge = state.driftCharge;
  player.boostTime = state.boostTime;
  player.drifting = state.drifting;
  player.lap = state.lap;
  player.progress = state.progress;
  player.finished = state.finished;
  player.lastProcessedInput = state.lastProcessedInput;
};

export class RaceRoom extends Room<{ state: RaceState }> {
  override maxClients = MAX_PLAYERS;
  override patchRate = 50;
  override state = new RaceState();

  private accumulator = 0;
  private readonly runtimes = new Map<string, PlayerRuntime>();

  override onCreate(): void {
    this.onMessage("input", (client, payload: unknown) => {
      this.receiveInput(client, payload);
    });

    this.onMessage("ping", (client, sentAt: unknown) => {
      if (typeof sentAt === "number" && Number.isFinite(sentAt)) {
        client.send("pong", sentAt);
      }
    });

    this.setSimulationInterval((deltaMilliseconds) => {
      this.updateSimulation(deltaMilliseconds / 1000);
    }, 1000 / 60);
  }

  override onJoin(client: Client, options: Record<string, unknown>): void {
    const spawn = createSpawnState(this.state.players.size);
    const player = new PlayerState();
    player.name = sanitizePlayerName(options.name);
    player.colorIndex = this.state.players.size % 8;
    applyKartState(player, spawn);

    this.state.players.set(client.sessionId, player);
    this.runtimes.set(client.sessionId, {
      heldInput: { ...NEUTRAL_INPUT },
      inputQueue: [],
      lastReceivedSequence: 0
    });
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.runtimes.delete(client.sessionId);
  }

  private receiveInput(client: Client, payload: unknown): void {
    const runtime = this.runtimes.get(client.sessionId);
    const input = sanitizeKartInput(payload);

    if (
      !runtime ||
      !input ||
      input.sequence <= runtime.lastReceivedSequence
    ) {
      return;
    }

    runtime.lastReceivedSequence = input.sequence;
    runtime.inputQueue.push(input);

    if (runtime.inputQueue.length > 120) {
      runtime.inputQueue.splice(0, runtime.inputQueue.length - 120);
    }
  }

  private updateSimulation(deltaSeconds: number): void {
    this.accumulator = Math.min(this.accumulator + deltaSeconds, 0.25);

    while (this.accumulator >= FIXED_TIMESTEP) {
      this.simulateTick();
      this.accumulator -= FIXED_TIMESTEP;
    }
  }

  private simulateTick(): void {
    this.state.players.forEach((player, sessionId) => {
      const runtime = this.runtimes.get(sessionId);
      if (!runtime) {
        return;
      }

      const queuedInput = runtime.inputQueue.shift();
      if (queuedInput) {
        runtime.heldInput = queuedInput;
      }

      const nextState = stepKart(
        toKartState(player),
        runtime.heldInput,
        FIXED_TIMESTEP
      );
      applyKartState(player, nextState);
    });

    this.state.serverTick += 1;
  }
}
