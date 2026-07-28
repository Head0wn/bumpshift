import {
  Client,
  getStateCallbacks,
  type Room
} from "@colyseus/sdk";
import {
  sanitizeRacePhase,
  type KartInput,
  type PlayerSnapshot,
  type RaceSnapshot
} from "@bumpshift/shared";

interface WirePlayer {
  name: string;
  colorIndex: number;
  ready: boolean;
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
  position: number;
  finishPosition: number;
  finishTimeMs: number;
  lastProcessedInput: number;
}

interface WireState {
  players: unknown;
  phase: string;
  serverTick: number;
  phaseEndsAtTick: number;
  raceStartedAtTick: number;
  round: number;
}

export interface NetworkEvents {
  onPlayer(snapshot: PlayerSnapshot): void;
  onPlayerLeft(playerId: string): void;
  onRace(snapshot: RaceSnapshot): void;
  onLatency(latencyMilliseconds: number): void;
  onDisconnect(): void;
}

const endpointFromEnvironment = (): string => {
  const configured = import.meta.env.VITE_SERVER_URL?.trim();
  if (configured) {
    return configured;
  }

  const protocol = window.location.protocol === "https:" ? "https" : "http";
  return `${protocol}://${window.location.hostname}:2567`;
};

const snapshotPlayer = (
  playerId: string,
  player: WirePlayer
): PlayerSnapshot => ({
  id: playerId,
  name: player.name,
  colorIndex: player.colorIndex,
  ready: player.ready,
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
  position: player.position,
  finishPosition: player.finishPosition,
  finishTimeMs: player.finishTimeMs,
  lastProcessedInput: player.lastProcessedInput
});

const snapshotRace = (state: WireState): RaceSnapshot => ({
  phase: sanitizeRacePhase(state.phase),
  serverTick: state.serverTick,
  phaseEndsAtTick: state.phaseEndsAtTick,
  raceStartedAtTick: state.raceStartedAtTick,
  round: state.round
});

export class NetworkSession {
  readonly sessionId: string;

  private readonly room: Room;
  private readonly pingInterval: number;

  private constructor(room: Room, events: NetworkEvents) {
    this.room = room;
    this.sessionId = room.sessionId;

    const callbacks = getStateCallbacks(room);
    const state = room.state as unknown as WireState;
    const stateCallbacks = callbacks(state);
    const publishRace = (): void => {
      events.onRace(snapshotRace(state));
    };

    stateCallbacks.players.onAdd(
      (player: WirePlayer, playerId: string) => {
        const publish = (): void => {
          events.onPlayer(snapshotPlayer(playerId, player));
        };
        publish();
        callbacks(player).onChange(publish);
      }
    );

    stateCallbacks.players.onRemove(
      (_player: WirePlayer, playerId: string) => {
        events.onPlayerLeft(playerId);
      }
    );
    publishRace();
    stateCallbacks.onChange(publishRace);

    room.onMessage("pong", (sentAt: number) => {
      events.onLatency(Math.max(0, Math.round(performance.now() - sentAt)));
    });
    room.onLeave(() => {
      events.onDisconnect();
    });

    this.pingInterval = window.setInterval(() => {
      room.send("ping", performance.now());
    }, 2000);
    room.send("ping", performance.now());
  }

  static async connect(
    playerName: string,
    events: NetworkEvents
  ): Promise<NetworkSession> {
    const client = new Client(endpointFromEnvironment());
    const room = await client.joinOrCreate("race", {
      name: playerName
    });
    return new NetworkSession(room, events);
  }

  sendInput(input: KartInput): void {
    this.room.send("input", input);
  }

  sendReady(ready: boolean): void {
    this.room.send("ready", ready);
  }

  async dispose(): Promise<void> {
    window.clearInterval(this.pingInterval);
    await this.room.leave();
  }
}
