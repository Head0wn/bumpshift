import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import {
  DEFAULT_TRACK_ID,
  FIXED_TIMESTEP,
  SIMULATION_HZ,
  TOTAL_LAPS,
  createSpawnState,
  getTrackDefinition,
  stepKart,
  type KartInput,
  type KartState,
  type PlayerSnapshot,
  type RaceSnapshot,
  type TrackId
} from "@bumpshift/shared";
import { InputController } from "./InputController";
import { KartVisual } from "./KartVisual";
import { NetworkSession } from "./NetworkSession";
import {
  createTrackVisual,
  type TrackVisualHandle
} from "./TrackVisual";
import {
  DEFAULT_GAME_SETTINGS,
  sanitizeGameSettings,
  type GameSettings
} from "./settings";

export interface HudElements {
  hud: HTMLElement;
  connectionLabel: HTMLElement;
  playerCount: HTMLElement;
  latency: HTMLElement;
  position: HTMLElement;
  fieldSize: HTMLElement;
  lap: HTMLElement;
  speed: HTMLElement;
  driftFill: HTMLElement;
  driftLevel: HTMLElement;
  raceOverlay: HTMLElement;
  phaseEyebrow: HTMLElement;
  phaseTitle: HTMLElement;
  phaseDetail: HTMLElement;
  phaseLights: HTMLElement;
  phaseStandings: HTMLElement;
  readyButton: HTMLButtonElement;
  controllerStatus: HTMLElement;
}

const snapshotToState = (snapshot: PlayerSnapshot): KartState => ({
  x: snapshot.x,
  z: snapshot.z,
  heading: snapshot.heading,
  speed: snapshot.speed,
  steer: snapshot.steer,
  driftCharge: snapshot.driftCharge,
  boostTime: snapshot.boostTime,
  drifting: snapshot.drifting,
  lap: snapshot.lap,
  checkpoint: snapshot.checkpoint,
  progress: snapshot.progress,
  finished: snapshot.finished,
  lastProcessedInput: snapshot.lastProcessedInput
});

const DEFAULT_RACE_SNAPSHOT: RaceSnapshot = {
  phase: "waiting",
  trackId: DEFAULT_TRACK_ID,
  serverTick: 0,
  phaseEndsAtTick: 0,
  raceStartedAtTick: 0,
  round: 1
};

const ordinal = (position: number): string =>
  position === 1 ? "1er" : `${position}e`;

const formatRaceTime = (milliseconds: number): string => {
  if (milliseconds < 0) {
    return "EN COURSE";
  }

  const totalSeconds = milliseconds / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.floor(milliseconds % 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
};

const createRenderingEngine = (canvas: HTMLCanvasElement): Engine =>
  new Engine(
    canvas,
    true,
    {
      alpha: false,
      antialias: true,
      audioEngine: false,
      preserveDrawingBuffer: false,
      stencil: false
    },
    false
  );

export class BumpshiftGame {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: UniversalCamera;
  private readonly input: InputController;
  private readonly hud: HudElements;
  private readonly glow: GlowLayer;
  private readonly visuals = new Map<string, KartVisual>();
  private readonly snapshots = new Map<string, PlayerSnapshot>();
  private readonly pendingInputs: KartInput[] = [];

  private connection: NetworkSession | null = null;
  private localPlayerId = "";
  private predictedState: KartState | null = null;
  private inputSequence = 0;
  private fixedAccumulator = 0;
  private cameraTarget = new Vector3(0, 1, 0);
  private raceState = { ...DEFAULT_RACE_SNAPSHOT };
  private trackVisual: TrackVisualHandle;
  private settings: GameSettings = { ...DEFAULT_GAME_SETTINGS };
  private wasBoosting = false;
  private connected = false;
  private disposed = false;
  private readonly readyClickHandler: () => void;

  private constructor(
    engine: Engine,
    scene: Scene,
    camera: UniversalCamera,
    input: InputController,
    hud: HudElements,
    glow: GlowLayer,
    trackVisual: TrackVisualHandle
  ) {
    this.engine = engine;
    this.scene = scene;
    this.camera = camera;
    this.input = input;
    this.hud = hud;
    this.glow = glow;
    this.trackVisual = trackVisual;
    this.readyClickHandler = () => {
      if (!this.connection || this.raceState.phase !== "waiting") {
        return;
      }
      const localPlayer = this.snapshots.get(this.localPlayerId);
      this.connection.sendReady(!(localPlayer?.ready ?? false));
    };
    this.hud.readyButton.addEventListener("click", this.readyClickHandler);

    this.engine.runRenderLoop(() => {
      this.frame();
    });
  }

  static async create(
    canvas: HTMLCanvasElement,
    touchRoot: HTMLElement,
    hud: HudElements
  ): Promise<BumpshiftGame> {
    const engine = createRenderingEngine(canvas);
    const devicePixelRatio = window.devicePixelRatio || 1;
    engine.setHardwareScalingLevel(
      Math.min(1.5, Math.max(1, devicePixelRatio / 1.35))
    );

    const scene = new Scene(engine);
    scene.clearColor = Color4.FromHexString("#07100fff");
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = Color3.FromHexString("#07100f");
    scene.fogStart = 82;
    scene.fogEnd = 188;
    scene.imageProcessingConfiguration.contrast = 1.18;
    scene.imageProcessingConfiguration.exposure = 1.08;

    const hemisphere = new HemisphericLight(
      "ambient",
      new Vector3(0, 1, 0),
      scene
    );
    hemisphere.intensity = 0.72;
    hemisphere.diffuse = Color3.FromHexString("#bfe8df");
    hemisphere.groundColor = Color3.FromHexString("#10201d");

    const sun = new DirectionalLight(
      "sun",
      new Vector3(-0.35, -0.82, 0.28),
      scene
    );
    sun.position = new Vector3(34, 70, -24);
    sun.intensity = 1.24;
    sun.diffuse = Color3.FromHexString("#d7fff1");

    const glow = new GlowLayer("neon", scene, {
      blurKernelSize: 24
    });
    glow.intensity = 0.45;

    const trackVisual = createTrackVisual(scene, DEFAULT_TRACK_ID);

    const camera = new UniversalCamera(
      "race-camera",
      new Vector3(0, 62, -86),
      scene
    );
    camera.fov = 0.92;
    camera.minZ = 0.1;
    camera.maxZ = 420;
    camera.setTarget(Vector3.Zero());

    const input = new InputController(touchRoot, {
      onGamepadStatus: (connected, label) => {
        hud.controllerStatus.textContent = connected
          ? `Manette · ${label.replace(/\s*\([^)]*\)\s*/g, " ").trim().slice(0, 28)}`
          : "Manette non détectée";
        hud.controllerStatus.classList.toggle("is-connected", connected);
      }
    });
    const game = new BumpshiftGame(
      engine,
      scene,
      camera,
      input,
      hud,
      glow,
      trackVisual
    );
    game.applySettings(DEFAULT_GAME_SETTINGS);

    const onResize = (): void => {
      engine.resize();
    };
    window.addEventListener("resize", onResize);
    scene.onDisposeObservable.add(() => {
      window.removeEventListener("resize", onResize);
    });

    return game;
  }

  previewTrack(trackId: TrackId): void {
    if (this.connected || this.connection) {
      return;
    }
    this.switchTrackVisual(trackId);
    this.raceState = {
      ...this.raceState,
      trackId
    };
  }

  applySettings(value: GameSettings): void {
    this.settings = sanitizeGameSettings(value);
    this.input.setVibrationEnabled(this.settings.vibration);

    const pixelRatio = window.devicePixelRatio || 1;
    const hardwareScaling =
      this.settings.graphicsQuality === "performance"
        ? Math.max(1.65, pixelRatio / 1.1)
        : this.settings.graphicsQuality === "quality"
          ? Math.max(1, pixelRatio / 1.8)
          : Math.min(1.5, Math.max(1, pixelRatio / 1.35));
    this.engine.setHardwareScalingLevel(hardwareScaling);
    this.glow.intensity =
      this.settings.graphicsQuality === "performance"
        ? 0.26
        : this.settings.graphicsQuality === "quality"
          ? 0.52
          : 0.42;
    this.engine.resize();
  }

  async connect(
    playerName: string,
    trackId: TrackId,
    colorIndex: number
  ): Promise<void> {
    if (this.connection) {
      return;
    }

    this.switchTrackVisual(trackId);
    const connection = await NetworkSession.connect(
      playerName,
      trackId,
      colorIndex,
      {
      onPlayer: (snapshot) => {
        this.upsertPlayer(snapshot);
      },
      onPlayerLeft: (playerId) => {
        this.removePlayer(playerId);
      },
      onRace: (snapshot) => {
        this.updateRaceSnapshot(snapshot);
      },
      onLatency: (latency) => {
        this.hud.latency.textContent = `${latency} ms`;
      },
      onDisconnect: () => {
        this.hud.connectionLabel.textContent = "Hors ligne";
        this.connected = false;
      }
      }
    );

    this.connection = connection;
    this.localPlayerId = connection.sessionId;
    this.connected = true;
    this.hud.hud.hidden = false;
    this.hud.connectionLabel.textContent = "Course en ligne";

    const initialSnapshot = this.snapshots.get(this.localPlayerId);
    this.predictedState = initialSnapshot
      ? snapshotToState(initialSnapshot)
      : createSpawnState(0, trackId);
    this.refreshRaceOverlay();
  }

  private switchTrackVisual(trackId: TrackId): void {
    if (this.trackVisual.trackId === trackId) {
      return;
    }

    this.trackVisual.dispose();
    this.trackVisual = createTrackVisual(this.scene, trackId);
    const isRiviera = trackId === "riviera-royale";
    const background = isRiviera ? "#07141c" : "#07100f";
    this.scene.clearColor = Color4.FromHexString(`${background}ff`);
    this.scene.fogColor = Color3.FromHexString(background);
    this.scene.fogStart = isRiviera ? 92 : 82;
    this.scene.fogEnd = isRiviera ? 205 : 188;
    this.camera.position.set(0, isRiviera ? 68 : 62, -86);
    this.cameraTarget.set(0, 1, 0);
    this.camera.setTarget(this.cameraTarget);
  }

  private upsertPlayer(snapshot: PlayerSnapshot): void {
    this.snapshots.set(snapshot.id, snapshot);

    let visual = this.visuals.get(snapshot.id);
    if (!visual) {
      visual = new KartVisual(
        this.scene,
        snapshot.colorIndex,
        snapshot.name
      );
      this.visuals.set(snapshot.id, visual);
      visual.update(snapshotToState(snapshot), FIXED_TIMESTEP, true);
    }

    if (snapshot.id !== this.localPlayerId || !this.predictedState) {
      return;
    }

    const acknowledgedSequence = snapshot.lastProcessedInput;
    let removeCount = 0;
    while (
      removeCount < this.pendingInputs.length &&
      (this.pendingInputs[removeCount]?.sequence ?? Number.POSITIVE_INFINITY) <=
        acknowledgedSequence
    ) {
      removeCount += 1;
    }
    if (removeCount > 0) {
      this.pendingInputs.splice(0, removeCount);
    }

    let reconciled = snapshotToState(snapshot);
    if (this.raceState.phase === "racing" && !reconciled.finished) {
      for (const input of this.pendingInputs) {
        reconciled = stepKart(
          reconciled,
          input,
          FIXED_TIMESTEP,
          this.raceState.trackId
        );
      }
    }
    this.predictedState = reconciled;
    document.body.classList.toggle(
      "is-driving",
      this.raceState.phase === "racing" && !snapshot.finished
    );
    this.refreshRaceOverlay();
  }

  private removePlayer(playerId: string): void {
    this.snapshots.delete(playerId);
    const visual = this.visuals.get(playerId);
    if (visual) {
      visual.dispose();
      this.visuals.delete(playerId);
    }
    this.refreshRaceOverlay();
  }

  private updateRaceSnapshot(snapshot: RaceSnapshot): void {
    const previousPhase = this.raceState.phase;
    if (snapshot.trackId !== this.trackVisual.trackId) {
      this.switchTrackVisual(snapshot.trackId);
    }
    this.raceState = snapshot;

    if (snapshot.phase !== previousPhase) {
      this.fixedAccumulator = 0;
      if (snapshot.phase !== "racing") {
        this.pendingInputs.length = 0;
      }

      const authoritative = this.snapshots.get(this.localPlayerId);
      if (authoritative) {
        this.predictedState = snapshotToState(authoritative);
      }
      if (snapshot.phase === "racing") {
        this.input.rumble(180, 0.35, 0.8);
      }
    }

    const localPlayer = this.snapshots.get(this.localPlayerId);
    document.body.classList.toggle(
      "is-driving",
      snapshot.phase === "racing" && !(localPlayer?.finished ?? false)
    );
    if (snapshot.phase !== "racing") {
      document.body.classList.remove("is-boosting");
    }

    this.hud.connectionLabel.textContent =
      snapshot.phase === "waiting"
        ? "Sur la grille"
        : snapshot.phase === "countdown"
          ? "Départ imminent"
          : snapshot.phase === "results"
            ? "Résultats officiels"
            : "Course en ligne";
    this.refreshRaceOverlay();
  }

  private frame(): void {
    if (this.disposed) {
      return;
    }

    const menuVisible =
      !document.body.classList.contains("is-driving") &&
      Boolean(
        document.querySelector(
          ".menu:not(.is-hidden):not([hidden]), .race-overlay:not([hidden])"
        )
      );
    this.input.updateMenuNavigation(menuVisible);

    const deltaSeconds = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    if (this.connected && this.connection && this.predictedState) {
      this.fixedAccumulator = Math.min(
        this.fixedAccumulator + deltaSeconds,
        0.2
      );

      while (this.fixedAccumulator >= FIXED_TIMESTEP) {
        const input = this.input.sample(++this.inputSequence);
        this.pendingInputs.push(input);
        if (this.pendingInputs.length > 180) {
          this.pendingInputs.shift();
        }
        this.connection.sendInput(input);
        if (
          this.raceState.phase === "racing" &&
          !this.predictedState.finished
        ) {
          this.predictedState = stepKart(
            this.predictedState,
            input,
            FIXED_TIMESTEP,
            this.raceState.trackId
          );
        }
        this.fixedAccumulator -= FIXED_TIMESTEP;
      }

      this.updateRace(deltaSeconds);
    } else {
      this.updateAttractCamera(deltaSeconds);
    }

    this.scene.render();
  }

  private updateRace(deltaSeconds: number): void {
    const localState = this.predictedState;
    if (!localState) {
      return;
    }

    for (const [playerId, visual] of this.visuals) {
      if (playerId === this.localPlayerId) {
        visual.update(localState, deltaSeconds);
        continue;
      }

      const snapshot = this.snapshots.get(playerId);
      if (snapshot) {
        visual.update(snapshotToState(snapshot), deltaSeconds);
      }
    }

    const forward = new Vector3(
      Math.sin(localState.heading),
      0,
      Math.cos(localState.heading)
    );
    const speedRatio = Math.min(1, Math.abs(localState.speed) / 34);
    const motion = this.settings.cameraMotion;
    const desiredPosition = new Vector3(localState.x, 0.55, localState.z)
      .subtract(forward.scale(8.8 + speedRatio * 1.8 * motion))
      .add(new Vector3(0, 4.25 + speedRatio * 0.65 * motion, 0));
    const desiredTarget = new Vector3(localState.x, 1.05, localState.z).add(
      forward.scale(4.8 + speedRatio * 2.5)
    );
    const cameraAmount = 1 - Math.exp(-deltaSeconds * 7.5);
    Vector3.LerpToRef(
      this.camera.position,
      desiredPosition,
      cameraAmount,
      this.camera.position
    );
    Vector3.LerpToRef(
      this.cameraTarget,
      desiredTarget,
      cameraAmount,
      this.cameraTarget
    );
    this.camera.setTarget(this.cameraTarget);
    this.camera.fov +=
      (0.88 + speedRatio * 0.12 * motion - this.camera.fov) *
      (1 - Math.exp(-deltaSeconds * 4));

    this.updateHud(localState);
  }

  private updateAttractCamera(deltaSeconds: number): void {
    const time = performance.now() / 1000;
    const desired = new Vector3(
      Math.cos(time * 0.1) * 96,
      52 + Math.sin(time * 0.14) * 7,
      Math.sin(time * 0.1) * 96
    );
    const amount = 1 - Math.exp(-deltaSeconds * 0.8);
    Vector3.LerpToRef(
      this.camera.position,
      desired,
      amount,
      this.camera.position
    );
    this.cameraTarget = Vector3.Lerp(
      this.cameraTarget,
      new Vector3(0, 0, 0),
      amount
    );
    this.camera.setTarget(this.cameraTarget);
  }

  private updateHud(localState: KartState): void {
    const localSnapshot = this.snapshots.get(this.localPlayerId);
    const rank = localSnapshot?.position ?? 1;
    const fieldSize = Math.max(1, this.snapshots.size);
    const chargeRatio = Math.min(1, localState.driftCharge / 1.25);

    this.hud.position.textContent = String(Math.max(1, rank));
    this.hud.fieldSize.textContent = String(fieldSize);
    this.hud.playerCount.textContent = `${fieldSize} pilote${fieldSize > 1 ? "s" : ""}`;
    this.hud.lap.textContent = String(
      Math.min(TOTAL_LAPS, Math.max(1, localState.lap))
    );
    this.hud.speed.textContent = String(
      Math.round(Math.abs(localState.speed) * 3.6)
    );
    this.hud.driftFill.style.width = `${chargeRatio * 100}%`;
    this.hud.driftLevel.textContent =
      chargeRatio >= 0.78
        ? "Ultra"
        : chargeRatio >= 0.44
          ? "Chargé"
          : chargeRatio >= 0.18
            ? "Étincelles"
            : "Prêt";
    const boosting = localState.boostTime > 0;
    document.body.classList.toggle("is-boosting", boosting);
    if (boosting && !this.wasBoosting) {
      this.input.rumble(110, 0.18, 0.42);
    }
    this.wasBoosting = boosting;
  }

  private refreshRaceOverlay(): void {
    if (!this.connected && !this.connection) {
      return;
    }

    const phase = this.raceState.phase;
    const localPlayer = this.snapshots.get(this.localPlayerId);
    const players = [...this.snapshots.values()].sort(
      (first, second) => first.position - second.position
    );
    const readyCount = players.filter((player) => player.ready).length;
    const ticksRemaining = Math.max(
      0,
      this.raceState.phaseEndsAtTick - this.raceState.serverTick
    );
    const secondsRemaining = Math.ceil(ticksRemaining / SIMULATION_HZ);

    this.hud.raceOverlay.dataset.phase = phase;
    this.hud.readyButton.hidden = phase !== "waiting";
    this.hud.readyButton.textContent = localPlayer?.ready
      ? "ANNULER"
      : "JE SUIS PRÊT";
    this.renderStandings(players, phase === "waiting");

    if (phase === "waiting") {
      const track = getTrackDefinition(this.raceState.trackId);
      this.hud.raceOverlay.hidden = false;
      this.hud.phaseEyebrow.textContent =
        `MANCHE ${this.raceState.round} · ${track.name.toUpperCase()}`;
      this.hud.phaseTitle.textContent = "GRILLE DE DÉPART";
      this.hud.phaseDetail.textContent =
        players.length === 0
          ? "Synchronisation des pilotes…"
          : `${readyCount}/${players.length} pilote${players.length > 1 ? "s" : ""} prêt${readyCount > 1 ? "s" : ""}`;
      this.setStartLights(0);
      return;
    }

    if (phase === "countdown") {
      const countdown = Math.max(1, Math.min(3, secondsRemaining));
      this.hud.raceOverlay.hidden = false;
      this.hud.phaseEyebrow.textContent = `MANCHE ${this.raceState.round}`;
      this.hud.phaseTitle.textContent = String(countdown);
      this.hud.phaseDetail.textContent = "Moteurs prêts";
      this.hud.phaseStandings.hidden = true;
      this.setStartLights(4 - countdown);
      return;
    }

    if (phase === "racing") {
      const justStarted =
        this.raceState.serverTick - this.raceState.raceStartedAtTick <
        SIMULATION_HZ;
      if (localPlayer?.finishPosition) {
        this.hud.raceOverlay.hidden = false;
        this.hud.raceOverlay.dataset.phase = "finished";
        this.hud.phaseEyebrow.textContent = "ARRIVÉE VALIDÉE";
        this.hud.phaseTitle.textContent = ordinal(localPlayer.finishPosition);
        this.hud.phaseDetail.textContent =
          `${formatRaceTime(localPlayer.finishTimeMs)} · En attente des autres pilotes`;
        this.hud.phaseStandings.hidden = false;
        this.setStartLights(0);
      } else if (justStarted) {
        this.hud.raceOverlay.hidden = false;
        this.hud.phaseEyebrow.textContent = "BUMPSHIFT";
        this.hud.phaseTitle.textContent = "GO !";
        this.hud.phaseDetail.textContent = "Dérape. Frappe. Termine premier.";
        this.hud.phaseStandings.hidden = true;
        this.setStartLights(3);
      } else {
        this.hud.raceOverlay.hidden = true;
      }
      return;
    }

    this.hud.raceOverlay.hidden = false;
    this.hud.phaseEyebrow.textContent = `MANCHE ${this.raceState.round} TERMINÉE`;
    this.hud.phaseTitle.textContent = localPlayer?.finishPosition
      ? ordinal(localPlayer.finishPosition)
      : "COURSE TERMINÉE";
    this.hud.phaseDetail.textContent =
      `Nouvelle grille dans ${secondsRemaining}s`;
    this.hud.phaseStandings.hidden = false;
    this.setStartLights(0);
  }

  private renderStandings(
    players: readonly PlayerSnapshot[],
    showReadyState: boolean
  ): void {
    const rows = players.map((player) => {
      const row = document.createElement("div");
      row.className = "standing-row";
      if (player.id === this.localPlayerId) {
        row.classList.add("is-local");
      }

      const position = document.createElement("span");
      position.className = "standing-row__position";
      position.textContent = showReadyState
        ? player.ready
          ? "✓"
          : "·"
        : `#${player.position}`;

      const name = document.createElement("strong");
      name.textContent = player.name;

      const status = document.createElement("span");
      status.className = "standing-row__status";
      status.textContent = showReadyState
        ? player.ready
          ? "PRÊT"
          : "EN ATTENTE"
        : player.finishPosition > 0
          ? formatRaceTime(player.finishTimeMs)
          : this.raceState.phase === "results"
            ? "DNF"
            : "EN COURSE";

      row.append(position, name, status);
      return row;
    });

    this.hud.phaseStandings.replaceChildren(...rows);
    this.hud.phaseStandings.hidden = players.length === 0;
  }

  private setStartLights(litCount: number): void {
    const lights = this.hud.phaseLights.querySelectorAll<HTMLElement>(
      ".start-light"
    );
    lights.forEach((light, index) => {
      light.classList.toggle("is-lit", index < litCount);
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.hud.readyButton.removeEventListener(
      "click",
      this.readyClickHandler
    );
    this.input.dispose();
    this.trackVisual.dispose();
    if (this.connection) {
      await this.connection.dispose();
    }
    this.scene.dispose();
    this.engine.dispose();
  }
}
