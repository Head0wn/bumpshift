import {
  COUNTDOWN_TICKS,
  FINISH_GRACE_TICKS,
  FIXED_TIMESTEP,
  MAX_PLAYERS,
  NEUTRAL_INPUT,
  RESULTS_TICKS,
  SIMULATION_HZ,
  createSpawnState,
  raceProgressScore,
  resolveKartCollisions,
  sanitizeKartInput,
  sanitizeKartColor,
  sanitizePlayerName,
  sanitizeTrackId,
  stepKart,
  type KartInput,
  type KartState,
  type TrackId
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
  checkpoint: player.checkpoint,
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
  player.checkpoint = state.checkpoint;
  player.progress = state.progress;
  player.finished = state.finished;
  player.lastProcessedInput = state.lastProcessedInput;
};

const frozenState = (
  player: PlayerState,
  acknowledgedSequence: number
): KartState => ({
  ...toKartState(player),
  speed: 0,
  steer: 0,
  driftCharge: 0,
  boostTime: 0,
  drifting: false,
  lastProcessedInput: acknowledgedSequence
});

export class RaceRoom extends Room<{
  state: RaceState;
  metadata: { trackId: TrackId };
}> {
  override maxClients = MAX_PLAYERS;
  override patchRate = 50;
  override state = new RaceState();

  private accumulator = 0;
  private readonly runtimes = new Map<string, PlayerRuntime>();

  override onCreate(options: Record<string, unknown>): void {
    this.state.trackId = sanitizeTrackId(options.trackId);

    this.onMessage("input", (client, payload: unknown) => {
      this.receiveInput(client, payload);
    });

    this.onMessage("ready", (client, payload: unknown) => {
      this.receiveReady(client, payload);
    });

    this.onMessage("ping", (client, sentAt: unknown) => {
      if (typeof sentAt === "number" && Number.isFinite(sentAt)) {
        client.send("pong", sentAt);
      }
    });

    this.setSimulationInterval((deltaMilliseconds) => {
      this.updateSimulation(deltaMilliseconds / 1000);
    }, 1000 / SIMULATION_HZ);
  }

  override onJoin(client: Client, options: Record<string, unknown>): void {
    const spawn = createSpawnState(
      this.state.players.size,
      sanitizeTrackId(this.state.trackId)
    );
    const player = new PlayerState();
    player.name = sanitizePlayerName(options.name);
    player.colorIndex = sanitizeKartColor(options.colorIndex);
    player.position = this.state.players.size + 1;
    applyKartState(player, spawn);

    this.state.players.set(client.sessionId, player);
    this.runtimes.set(client.sessionId, {
      heldInput: { ...NEUTRAL_INPUT },
      inputQueue: [],
      lastReceivedSequence: 0
    });
    this.updatePositions();
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.runtimes.delete(client.sessionId);
    this.updatePositions();

    if (this.state.phase === "waiting") {
      this.startCountdownIfReady();
    } else if (this.state.phase === "racing") {
      this.finishRaceIfComplete();
    }
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

  private receiveReady(client: Client, payload: unknown): void {
    if (this.state.phase !== "waiting" || typeof payload !== "boolean") {
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }

    player.ready = payload;
    this.startCountdownIfReady();
  }

  private updateSimulation(deltaSeconds: number): void {
    this.accumulator = Math.min(this.accumulator + deltaSeconds, 0.25);

    while (this.accumulator >= FIXED_TIMESTEP) {
      this.simulateTick();
      this.accumulator -= FIXED_TIMESTEP;
    }
  }

  private simulateTick(): void {
    this.state.serverTick += 1;
    this.advancePhase();

    const activePlayers: PlayerState[] = [];
    const activeStates: KartState[] = [];

    this.state.players.forEach((player, sessionId) => {
      const runtime = this.runtimes.get(sessionId);
      if (!runtime) {
        return;
      }

      const queuedInput = runtime.inputQueue.shift();
      if (queuedInput) {
        runtime.heldInput = queuedInput;
      }

      if (this.state.phase !== "racing" || player.finished) {
        applyKartState(
          player,
          frozenState(player, runtime.heldInput.sequence)
        );
        return;
      }

      const wasFinished = player.finished;
      const nextState = stepKart(
        toKartState(player),
        runtime.heldInput,
        FIXED_TIMESTEP,
        sanitizeTrackId(this.state.trackId)
      );

      if (!wasFinished && nextState.finished) {
        player.finishPosition = this.finishedPlayerCount() + 1;
        player.finishTimeMs = Math.max(
          0,
          Math.round(
            ((this.state.serverTick - this.state.raceStartedAtTick) /
              SIMULATION_HZ) *
              1000
          )
        );
        if (this.state.phaseEndsAtTick === 0) {
          this.state.phaseEndsAtTick =
            this.state.serverTick + FINISH_GRACE_TICKS;
        }
      }

      activePlayers.push(player);
      activeStates.push(nextState);
    });

    const resolvedStates = resolveKartCollisions(
      activeStates,
      sanitizeTrackId(this.state.trackId)
    );
    for (let index = 0; index < activePlayers.length; index += 1) {
      const player = activePlayers[index];
      const resolved = resolvedStates[index];
      if (player && resolved) {
        applyKartState(player, resolved);
      }
    }

    this.updatePositions();
    this.finishRaceIfComplete();
  }

  private advancePhase(): void {
    if (
      this.state.phase === "countdown" &&
      this.state.serverTick >= this.state.phaseEndsAtTick
    ) {
      this.state.phase = "racing";
      this.state.raceStartedAtTick = this.state.serverTick;
      this.state.phaseEndsAtTick = 0;
      return;
    }

    if (
      this.state.phase === "racing" &&
      this.state.phaseEndsAtTick > 0 &&
      this.state.serverTick >= this.state.phaseEndsAtTick
    ) {
      this.beginResults();
      return;
    }

    if (
      this.state.phase === "results" &&
      this.state.serverTick >= this.state.phaseEndsAtTick
    ) {
      this.resetLobby();
    }
  }

  private startCountdownIfReady(): void {
    if (
      this.state.phase !== "waiting" ||
      this.state.players.size === 0
    ) {
      return;
    }

    let everyoneReady = true;
    this.state.players.forEach((player) => {
      everyoneReady &&= player.ready;
    });
    if (!everyoneReady) {
      return;
    }

    this.state.phase = "countdown";
    this.state.phaseEndsAtTick = this.state.serverTick + COUNTDOWN_TICKS;
    this.state.raceStartedAtTick = 0;
    this.resetKarts(true);
    void this.lock().catch(() => undefined);
  }

  private finishRaceIfComplete(): void {
    if (
      this.state.phase !== "racing" ||
      this.state.players.size === 0
    ) {
      return;
    }

    let everyoneFinished = true;
    this.state.players.forEach((player) => {
      everyoneFinished &&= player.finished;
    });
    if (everyoneFinished) {
      this.beginResults();
    }
  }

  private beginResults(): void {
    if (this.state.phase === "results") {
      return;
    }

    this.state.phase = "results";
    this.state.phaseEndsAtTick = this.state.serverTick + RESULTS_TICKS;
    this.state.players.forEach((player) => {
      player.speed = 0;
      player.steer = 0;
      player.drifting = false;
      player.boostTime = 0;
    });
    this.updatePositions();
  }

  private resetLobby(): void {
    this.state.phase = "waiting";
    this.state.phaseEndsAtTick = 0;
    this.state.raceStartedAtTick = 0;
    this.state.round += 1;
    this.resetKarts(false);
    void this.unlock().catch(() => undefined);
  }

  private resetKarts(keepReady: boolean): void {
    let slot = 0;
    this.state.players.forEach((player, sessionId) => {
      const runtime = this.runtimes.get(sessionId);
      const acknowledgedSequence = runtime?.lastReceivedSequence ?? 0;
      const spawn = {
        ...createSpawnState(slot, sanitizeTrackId(this.state.trackId)),
        lastProcessedInput: acknowledgedSequence
      };
      applyKartState(player, spawn);
      player.ready = keepReady && player.ready;
      player.position = slot + 1;
      player.finishPosition = 0;
      player.finishTimeMs = -1;

      if (runtime) {
        runtime.heldInput = {
          ...NEUTRAL_INPUT,
          sequence: acknowledgedSequence
        };
        runtime.inputQueue.length = 0;
      }
      slot += 1;
    });
    this.updatePositions();
  }

  private finishedPlayerCount(): number {
    let count = 0;
    this.state.players.forEach((player) => {
      if (player.finishPosition > 0) {
        count += 1;
      }
    });
    return count;
  }

  private updatePositions(): void {
    const ranked: PlayerState[] = [];
    this.state.players.forEach((player) => {
      ranked.push(player);
    });

    ranked.sort((first, second) => {
      if (first.finishPosition > 0 || second.finishPosition > 0) {
        if (first.finishPosition === 0) {
          return 1;
        }
        if (second.finishPosition === 0) {
          return -1;
        }
        return first.finishPosition - second.finishPosition;
      }

      return raceProgressScore(toKartState(second)) -
        raceProgressScore(toKartState(first));
    });

    ranked.forEach((player, index) => {
      player.position = index + 1;
    });
  }
}
