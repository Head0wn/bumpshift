import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import {
  FIXED_TIMESTEP,
  TOTAL_LAPS,
  createSpawnState,
  stepKart,
  type KartInput,
  type KartState,
  type PlayerSnapshot
} from "@bumpshift/shared";
import { InputController } from "./InputController";
import { KartVisual } from "./KartVisual";
import { NetworkSession } from "./NetworkSession";
import { createTrackVisual } from "./TrackVisual";

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
  progress: snapshot.progress,
  finished: snapshot.finished,
  lastProcessedInput: snapshot.lastProcessedInput
});

const scoreState = (state: Readonly<KartState>): number =>
  (state.lap - 1) + state.progress;

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
  private readonly visuals = new Map<string, KartVisual>();
  private readonly snapshots = new Map<string, PlayerSnapshot>();
  private readonly pendingInputs: KartInput[] = [];

  private connection: NetworkSession | null = null;
  private localPlayerId = "";
  private predictedState: KartState | null = null;
  private inputSequence = 0;
  private fixedAccumulator = 0;
  private cameraTarget = new Vector3(0, 1, 0);
  private connected = false;
  private disposed = false;

  private constructor(
    engine: Engine,
    scene: Scene,
    camera: UniversalCamera,
    input: InputController,
    hud: HudElements
  ) {
    this.engine = engine;
    this.scene = scene;
    this.camera = camera;
    this.input = input;
    this.hud = hud;

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

    createTrackVisual(scene);

    const camera = new UniversalCamera(
      "race-camera",
      new Vector3(0, 62, -86),
      scene
    );
    camera.fov = 0.92;
    camera.minZ = 0.1;
    camera.maxZ = 420;
    camera.setTarget(Vector3.Zero());

    const input = new InputController(touchRoot);
    const game = new BumpshiftGame(engine, scene, camera, input, hud);

    const onResize = (): void => {
      engine.resize();
    };
    window.addEventListener("resize", onResize);
    scene.onDisposeObservable.add(() => {
      window.removeEventListener("resize", onResize);
    });

    return game;
  }

  async connect(playerName: string): Promise<void> {
    if (this.connection) {
      return;
    }

    const connection = await NetworkSession.connect(playerName, {
      onPlayer: (snapshot) => {
        this.upsertPlayer(snapshot);
      },
      onPlayerLeft: (playerId) => {
        this.removePlayer(playerId);
      },
      onLatency: (latency) => {
        this.hud.latency.textContent = `${latency} ms`;
      },
      onDisconnect: () => {
        this.hud.connectionLabel.textContent = "Hors ligne";
        this.connected = false;
      }
    });

    this.connection = connection;
    this.localPlayerId = connection.sessionId;
    this.connected = true;
    this.hud.hud.hidden = false;
    this.hud.connectionLabel.textContent = "Course en ligne";

    const initialSnapshot = this.snapshots.get(this.localPlayerId);
    this.predictedState = initialSnapshot
      ? snapshotToState(initialSnapshot)
      : createSpawnState(0);
  }

  private upsertPlayer(snapshot: PlayerSnapshot): void {
    this.snapshots.set(snapshot.id, snapshot);

    let visual = this.visuals.get(snapshot.id);
    if (!visual) {
      visual = new KartVisual(this.scene, snapshot.colorIndex);
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
    for (const input of this.pendingInputs) {
      reconciled = stepKart(reconciled, input, FIXED_TIMESTEP);
    }
    this.predictedState = reconciled;
  }

  private removePlayer(playerId: string): void {
    this.snapshots.delete(playerId);
    const visual = this.visuals.get(playerId);
    if (visual) {
      visual.dispose();
      this.visuals.delete(playerId);
    }
  }

  private frame(): void {
    if (this.disposed) {
      return;
    }

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
        this.predictedState = stepKart(
          this.predictedState,
          input,
          FIXED_TIMESTEP
        );
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
    const desiredPosition = new Vector3(localState.x, 0.55, localState.z)
      .subtract(forward.scale(8.8 + speedRatio * 1.8))
      .add(new Vector3(0, 4.25 + speedRatio * 0.65, 0));
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
      (0.88 + speedRatio * 0.12 - this.camera.fov) *
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
    const racers: KartState[] = [];
    for (const [playerId, snapshot] of this.snapshots) {
      racers.push(
        playerId === this.localPlayerId
          ? localState
          : snapshotToState(snapshot)
      );
    }
    racers.sort((a, b) => scoreState(b) - scoreState(a));
    const rank = racers.indexOf(localState) + 1;
    const fieldSize = Math.max(1, racers.length);
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
    document.body.classList.toggle("is-boosting", localState.boostTime > 0);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.input.dispose();
    if (this.connection) {
      await this.connection.dispose();
    }
    this.scene.dispose();
    this.engine.dispose();
  }
}
