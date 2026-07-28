import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Axis, Space } from "@babylonjs/core/Maths/math.axis";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import {
  trackHeightAtProgress,
  type KartState,
  type TrackId
} from "@bumpshift/shared";
import {
  KART_ASSET_PATHS,
  type AssetInstance,
  type GameAssetLibrary
} from "./AssetLibrary";

export const KART_PALETTES = [
  { name: "Nova", color: "#8f73d8" },
  { name: "Comète", color: "#d8688b" },
  { name: "Solaire", color: "#d7a83f" },
  { name: "Lagune", color: "#38a99a" },
  { name: "Corail", color: "#c99083" }
] as const;

let visualSequence = 0;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const normalizeAngle = (angle: number): number =>
  Math.atan2(Math.sin(angle), Math.cos(angle));

const lerpAngle = (from: number, to: number, amount: number): number =>
  from + normalizeAngle(to - from) * amount;

const makeMaterial = (
  scene: Scene,
  name: string,
  diffuse: string,
  emissiveIntensity = 0
): StandardMaterial => {
  const result = new StandardMaterial(name, scene);
  const color = Color3.FromHexString(diffuse);
  result.diffuseColor = color;
  result.specularColor = new Color3(0.48, 0.5, 0.5);
  result.specularPower = 72;
  result.emissiveColor = color.scale(emissiveIntensity);
  return result;
};

const ellipsoid = (
  scene: Scene,
  name: string,
  scaling: Vector3,
  position: Vector3,
  trackMaterial: StandardMaterial,
  parent: TransformNode
): Mesh => {
  const mesh = MeshBuilder.CreateSphere(
    name,
    { diameter: 2, segments: 20 },
    scene
  );
  mesh.scaling.copyFrom(scaling);
  mesh.position.copyFrom(position);
  mesh.material = trackMaterial;
  mesh.parent = parent;
  return mesh;
};

export class KartVisual {
  readonly root: TransformNode;

  private readonly bodyPivot: TransformNode;
  private readonly frontWheelPivots: TransformNode[] = [];
  private readonly wheelDetails: TransformNode[] = [];
  private readonly detailedFrontWheelPivots: TransformNode[] = [];
  private readonly detailedWheelNodes: TransformNode[] = [];
  private readonly sparks: Mesh[] = [];
  private readonly boostFlames: Mesh[] = [];
  private readonly nameplate: Mesh;
  private readonly accentMaterial: StandardMaterial;
  private readonly fallbackMeshes: Mesh[];
  private detailedModel: AssetInstance | null = null;
  private disposed = false;
  private wheelRotation = 0;

  constructor(
    scene: Scene,
    colorIndex: number,
    pilotName = "Pilote",
    assetLibrary?: GameAssetLibrary,
    onDetailedMeshesReady?: (
      meshes: readonly AbstractMesh[]
    ) => void
  ) {
    const visualId = ++visualSequence;
    const accent =
      KART_PALETTES[colorIndex % KART_PALETTES.length]?.color ??
      KART_PALETTES[0].color;
    const accentMaterial = makeMaterial(
      scene,
      `kart-accent-${visualId}`,
      accent
    );
    const accentDarkMaterial = makeMaterial(
      scene,
      `kart-accent-dark-${visualId}`,
      Color3.FromHexString(accent).scale(0.62).toHexString()
    );
    const darkMaterial = makeMaterial(
      scene,
      `kart-dark-${visualId}`,
      "#172026"
    );
    darkMaterial.specularColor = new Color3(0.22, 0.25, 0.27);
    const rubberMaterial = makeMaterial(
      scene,
      `kart-rubber-${visualId}`,
      "#111416"
    );
    rubberMaterial.specularColor = new Color3(0.08, 0.08, 0.08);
    const metalMaterial = makeMaterial(
      scene,
      `kart-metal-${visualId}`,
      "#aeb9b9"
    );
    metalMaterial.specularColor = new Color3(0.85, 0.9, 0.9);
    metalMaterial.specularPower = 96;
    const glassMaterial = makeMaterial(
      scene,
      `kart-glass-${visualId}`,
      "#28434e",
      0.08
    );
    glassMaterial.alpha = 0.92;
    const suitMaterial = makeMaterial(
      scene,
      `pilot-suit-${visualId}`,
      "#f1eee4"
    );
    const glowMaterial = makeMaterial(
      scene,
      `kart-effects-${visualId}`,
      "#58d9d2",
      1
    );
    glowMaterial.disableLighting = true;
    const redLightMaterial = makeMaterial(
      scene,
      `kart-brake-lights-${visualId}`,
      "#f34b43",
      1
    );
    redLightMaterial.disableLighting = true;

    this.accentMaterial = accentMaterial;
    this.root = new TransformNode("kart-root", scene);
    this.bodyPivot = new TransformNode("kart-body-pivot", scene);
    this.bodyPivot.parent = this.root;

    const shadow = MeshBuilder.CreateDisc(
      "kart-shadow",
      { radius: 1.42, tessellation: 36 },
      scene
    );
    const shadowMaterial = makeMaterial(
      scene,
      `kart-shadow-${visualId}`,
      "#000000"
    );
    shadowMaterial.alpha = 0.2;
    shadowMaterial.disableLighting = true;
    shadow.material = shadowMaterial;
    shadow.rotation.x = Math.PI / 2;
    shadow.scaling.y = 0.58;
    shadow.position.y = 0.035;
    shadow.parent = this.root;

    const fallbackMeshStart = scene.meshes.length;

    const undertray = MeshBuilder.CreateCapsule(
      "kart-undertray",
      {
        radius: 0.7,
        height: 2.7,
        tessellation: 18,
        subdivisions: 3
      },
      scene
    );
    undertray.material = darkMaterial;
    undertray.position.set(0, 0.55, 0.05);
    undertray.rotation.x = Math.PI / 2;
    undertray.scaling.x = 1.18;
    undertray.scaling.z = 0.52;
    undertray.parent = this.bodyPivot;

    ellipsoid(
      scene,
      "kart-main-shell",
      new Vector3(0.82, 0.26, 1.02),
      new Vector3(0, 0.78, 0.02),
      accentMaterial,
      this.bodyPivot
    );
    ellipsoid(
      scene,
      "kart-nose-shell",
      new Vector3(0.61, 0.17, 0.62),
      new Vector3(0, 0.73, 1.08),
      accentMaterial,
      this.bodyPivot
    );
    ellipsoid(
      scene,
      "kart-engine-cover",
      new Vector3(0.62, 0.29, 0.48),
      new Vector3(0, 0.86, -0.86),
      accentDarkMaterial,
      this.bodyPivot
    );

    for (const side of [-1, 1]) {
      ellipsoid(
        scene,
        "kart-side-pod",
        new Vector3(0.29, 0.21, 0.68),
        new Vector3(side * 0.83, 0.65, 0.02),
        accentDarkMaterial,
        this.bodyPivot
      );

      const suspension = MeshBuilder.CreateCylinder(
        "kart-suspension",
        { diameter: 0.08, height: 0.72, tessellation: 8 },
        scene
      );
      suspension.material = metalMaterial;
      suspension.position.set(side * 0.68, 0.52, 0.92);
      suspension.rotation.z = Math.PI / 2;
      suspension.parent = this.bodyPivot;
    }

    const frontBumper = MeshBuilder.CreateCapsule(
      "kart-front-bumper",
      {
        radius: 0.11,
        height: 2.12,
        tessellation: 12,
        subdivisions: 2
      },
      scene
    );
    frontBumper.material = darkMaterial;
    frontBumper.position.set(0, 0.45, 1.55);
    frontBumper.rotation.z = Math.PI / 2;
    frontBumper.parent = this.bodyPivot;

    const rearBumper = frontBumper.clone("kart-rear-bumper");
    rearBumper.position.z = -1.5;

    const seat = ellipsoid(
      scene,
      "kart-seat",
      new Vector3(0.48, 0.44, 0.55),
      new Vector3(0, 1.02, -0.28),
      darkMaterial,
      this.bodyPivot
    );
    seat.scaling.z = 0.46;

    ellipsoid(
      scene,
      "pilot-torso",
      new Vector3(0.32, 0.43, 0.29),
      new Vector3(0, 1.22, -0.22),
      suitMaterial,
      this.bodyPivot
    );
    const helmet = ellipsoid(
      scene,
      "pilot-helmet",
      new Vector3(0.4, 0.42, 0.41),
      new Vector3(0, 1.67, -0.2),
      accentMaterial,
      this.bodyPivot
    );
    helmet.scaling.z = 0.43;

    const helmetStripe = MeshBuilder.CreateBox(
      "pilot-helmet-stripe",
      { width: 0.1, height: 0.72, depth: 0.03 },
      scene
    );
    helmetStripe.material = suitMaterial;
    helmetStripe.position.set(0, 1.72, 0.18);
    helmetStripe.parent = this.bodyPivot;

    const visor = ellipsoid(
      scene,
      "pilot-visor",
      new Vector3(0.34, 0.14, 0.08),
      new Vector3(0, 1.69, 0.18),
      glassMaterial,
      this.bodyPivot
    );
    visor.scaling.z = 0.06;

    const steeringWheel = MeshBuilder.CreateTorus(
      "steering-wheel",
      { diameter: 0.5, thickness: 0.065, tessellation: 20 },
      scene
    );
    steeringWheel.material = darkMaterial;
    steeringWheel.position.set(0, 1.16, 0.48);
    steeringWheel.rotation.x = Math.PI * 0.38;
    steeringWheel.parent = this.bodyPivot;

    const rearWing = MeshBuilder.CreateBox(
      "kart-wing",
      { width: 1.9, height: 0.13, depth: 0.38 },
      scene
    );
    rearWing.material = accentMaterial;
    rearWing.position.set(0, 1.15, -1.37);
    rearWing.rotation.x = -0.08;
    rearWing.parent = this.bodyPivot;

    for (const side of [-0.63, 0.63]) {
      const wingSupport = MeshBuilder.CreateCylinder(
        "kart-wing-support",
        { diameter: 0.09, height: 0.5, tessellation: 8 },
        scene
      );
      wingSupport.material = darkMaterial;
      wingSupport.position.set(side, 0.93, -1.35);
      wingSupport.parent = this.bodyPivot;
    }

    for (const x of [-0.98, 0.98]) {
      for (const z of [-0.93, 0.93]) {
        const pivot = new TransformNode("kart-wheel-pivot", scene);
        pivot.position.set(x, 0.48, z);
        pivot.parent = this.bodyPivot;
        if (z > 0) {
          this.frontWheelPivots.push(pivot);
        }

        const tire = MeshBuilder.CreateTorus(
          "kart-tire",
          {
            diameter: 0.64,
            thickness: 0.23,
            tessellation: 20
          },
          scene
        );
        tire.material = rubberMaterial;
        tire.rotation.z = Math.PI / 2;
        tire.parent = pivot;

        const rim = MeshBuilder.CreateCylinder(
          "kart-rim",
          { diameter: 0.34, height: 0.25, tessellation: 16 },
          scene
        );
        rim.material = metalMaterial;
        rim.rotation.z = Math.PI / 2;
        rim.parent = pivot;

        const hub = MeshBuilder.CreateCylinder(
          "kart-wheel-hub",
          { diameter: 0.13, height: 0.29, tessellation: 12 },
          scene
        );
        hub.material = accentMaterial;
        hub.rotation.z = Math.PI / 2;
        hub.parent = pivot;
        this.wheelDetails.push(pivot);
      }
    }

    for (const x of [-0.5, 0.5]) {
      const brakeLight = MeshBuilder.CreateSphere(
        "kart-brake-light",
        { diameter: 0.18, segments: 10 },
        scene
      );
      brakeLight.scaling.z = 0.45;
      brakeLight.material = redLightMaterial;
      brakeLight.position.set(x, 0.79, -1.38);
      brakeLight.parent = this.bodyPivot;

      const exhaust = MeshBuilder.CreateCylinder(
        "kart-exhaust",
        { diameter: 0.18, height: 0.38, tessellation: 12 },
        scene
      );
      exhaust.material = metalMaterial;
      exhaust.position.set(x, 0.52, -1.51);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.parent = this.bodyPivot;
    }

    const diffuser = MeshBuilder.CreateBox(
      "kart-diffuser",
      { width: 1.35, height: 0.14, depth: 0.32 },
      scene
    );
    diffuser.material = darkMaterial;
    diffuser.position.set(0, 0.39, -1.43);
    diffuser.rotation.x = -0.13;
    diffuser.parent = this.bodyPivot;

    const numberTexture = new DynamicTexture(
      `kart-number-texture-${visualId}`,
      { width: 256, height: 256 },
      scene,
      false
    );
    numberTexture.hasAlpha = true;
    numberTexture.drawText(
      String((colorIndex % KART_PALETTES.length) + 1).padStart(2, "0"),
      null,
      178,
      "italic 900 132px Arial",
      "#182025",
      "transparent",
      true,
      true
    );
    const numberMaterial = new StandardMaterial(
      `kart-number-material-${visualId}`,
      scene
    );
    numberMaterial.diffuseTexture = numberTexture;
    numberMaterial.emissiveTexture = numberTexture;
    numberMaterial.opacityTexture = numberTexture;
    numberMaterial.disableLighting = true;
    numberMaterial.backFaceCulling = false;
    const numberPlate = MeshBuilder.CreatePlane(
      "kart-number",
      { width: 0.62, height: 0.62 },
      scene
    );
    numberPlate.material = numberMaterial;
    numberPlate.position.set(0, 0.9, 1.59);
    numberPlate.rotation.x = Math.PI / 2;
    numberPlate.parent = this.bodyPivot;
    this.fallbackMeshes = scene.meshes
      .slice(fallbackMeshStart)
      .filter((mesh): mesh is Mesh => mesh instanceof Mesh);

    const nameTexture = new DynamicTexture(
      `kart-name-texture-${visualId}`,
      { width: 512, height: 96 },
      scene,
      false
    );
    nameTexture.hasAlpha = true;
    nameTexture.drawText(
      pilotName.toUpperCase().slice(0, 16),
      null,
      66,
      "800 42px Arial",
      "#ffffff",
      "transparent",
      true,
      true
    );
    const nameMaterial = new StandardMaterial(
      `kart-name-material-${visualId}`,
      scene
    );
    nameMaterial.diffuseTexture = nameTexture;
    nameMaterial.emissiveTexture = nameTexture;
    nameMaterial.opacityTexture = nameTexture;
    nameMaterial.disableLighting = true;
    nameMaterial.backFaceCulling = false;
    this.nameplate = MeshBuilder.CreatePlane(
      "kart-nameplate",
      { width: 1.8, height: 0.34 },
      scene
    );
    this.nameplate.material = nameMaterial;
    this.nameplate.position.set(0, 3.15, 0);
    this.nameplate.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.nameplate.parent = this.root;

    for (const x of [-0.48, 0.48]) {
      const spark = MeshBuilder.CreateSphere(
        "drift-spark",
        { diameter: 0.16, segments: 8 },
        scene
      );
      spark.material = glowMaterial;
      spark.position.set(x, 0.31, -1.25);
      spark.parent = this.bodyPivot;
      spark.setEnabled(false);
      this.sparks.push(spark);

      const flame = MeshBuilder.CreateCylinder(
        "boost-flame",
        {
          diameterTop: 0.07,
          diameterBottom: 0.26,
          height: 0.65,
          tessellation: 12
        },
        scene
      );
      flame.material = glowMaterial;
      flame.position.set(x, 0.52, -1.72);
      flame.rotation.x = Math.PI / 2;
      flame.parent = this.bodyPivot;
      flame.setEnabled(false);
      this.boostFlames.push(flame);
    }

    if (assetLibrary) {
      void this.loadDetailedModel(
        assetLibrary,
        colorIndex,
        onDetailedMeshesReady
      );
    }
  }

  setLocalPlayer(local: boolean): void {
    this.nameplate.setEnabled(!local);
  }

  update(
    state: Readonly<KartState>,
    deltaSeconds: number,
    trackId: TrackId,
    snap = false
  ): void {
    const amount = snap ? 1 : 1 - Math.exp(-deltaSeconds * 13);
    const targetPosition = new Vector3(
      state.x,
      trackHeightAtProgress(trackId, state.progress) + 0.12,
      state.z
    );
    Vector3.LerpToRef(
      this.root.position,
      targetPosition,
      amount,
      this.root.position
    );
    this.root.rotation.y = lerpAngle(
      this.root.rotation.y,
      state.heading,
      amount
    );

    const speedRatio = Math.min(1, Math.abs(state.speed) / 34);
    const leanTarget = -state.steer * (0.045 + speedRatio * 0.085);
    this.bodyPivot.rotation.z +=
      (leanTarget - this.bodyPivot.rotation.z) *
      (1 - Math.exp(-deltaSeconds * 8));
    this.bodyPivot.position.y =
      Math.sin(performance.now() * 0.012) * speedRatio * 0.025;

    const wheelStep = state.speed * deltaSeconds / 0.32;
    this.wheelRotation += wheelStep;
    for (const pivot of this.frontWheelPivots) {
      pivot.rotation.y +=
        (state.steer * 0.3 - pivot.rotation.y) *
        (1 - Math.exp(-deltaSeconds * 12));
    }
    for (const pivot of this.detailedFrontWheelPivots) {
      pivot.rotation.y +=
        (state.steer * 0.3 - pivot.rotation.y) *
        (1 - Math.exp(-deltaSeconds * 12));
    }
    for (const detail of this.wheelDetails) {
      detail.rotation.x = this.wheelRotation;
    }
    for (const detail of this.detailedWheelNodes) {
      detail.rotate(Axis.X, wheelStep, Space.LOCAL);
    }

    const chargeRatio = clamp01(state.driftCharge / 1.25);
    const sparkColor =
      chargeRatio > 0.78
        ? Color3.FromHexString("#f0604f")
        : chargeRatio > 0.42
          ? Color3.FromHexString("#f3c84b")
          : Color3.FromHexString("#4dcac5");

    for (const [index, spark] of this.sparks.entries()) {
      spark.setEnabled(state.drifting);
      const pulse = 0.8 + Math.sin(performance.now() * 0.025 + index) * 0.25;
      spark.scaling.setAll(pulse * (0.65 + chargeRatio));
      const sparkMaterial = spark.material as StandardMaterial;
      sparkMaterial.emissiveColor = sparkColor;
      sparkMaterial.diffuseColor = sparkColor;
    }

    for (const [index, flame] of this.boostFlames.entries()) {
      flame.setEnabled(state.boostTime > 0);
      const pulse = 0.8 + Math.sin(performance.now() * 0.04 + index) * 0.15;
      flame.scaling.y = pulse;
    }

    this.accentMaterial.emissiveColor =
      state.boostTime > 0
        ? this.accentMaterial.diffuseColor.scale(0.16)
        : Color3.Black();
  }

  dispose(): void {
    this.disposed = true;
    this.detailedModel?.dispose();
    this.detailedModel = null;
    this.detailedFrontWheelPivots.length = 0;
    this.detailedWheelNodes.length = 0;
    this.root.dispose(false, true);
  }

  private async loadDetailedModel(
    assetLibrary: GameAssetLibrary,
    colorIndex: number,
    onDetailedMeshesReady?: (
      meshes: readonly AbstractMesh[]
    ) => void
  ): Promise<void> {
    const path =
      KART_ASSET_PATHS[colorIndex % KART_ASSET_PATHS.length] ??
      KART_ASSET_PATHS[0];

    try {
      const model = await assetLibrary.instantiate(path, "kart-model");
      if (this.disposed) {
        model.dispose();
        return;
      }

      model.root.parent = this.bodyPivot;
      model.root.position.set(0, 0.04, 0);
      model.root.scaling.setAll(2.16);
      for (const node of model.nodes) {
        if (
          !(node instanceof TransformNode) ||
          !node.name.includes("wheel-")
        ) {
          continue;
        }
        if (node.name.includes("wheel-front-")) {
          const steeringPivot = new TransformNode(
            `${node.name}-steering`,
            this.root.getScene()
          );
          steeringPivot.parent = node.parent;
          steeringPivot.position.copyFrom(node.position);
          node.parent = steeringPivot;
          node.position.setAll(0);
          this.detailedFrontWheelPivots.push(steeringPivot);
        }
        this.detailedWheelNodes.push(node);
      }
      for (const mesh of model.meshes) {
        mesh.receiveShadows = true;
      }
      for (const fallbackMesh of this.fallbackMeshes) {
        fallbackMesh.setEnabled(false);
      }
      this.detailedModel = model;
      onDetailedMeshesReady?.(model.meshes);
    } catch (error) {
      console.warn(
        "Le modèle de kart détaillé n'a pas pu être chargé.",
        error
      );
    }
  }
}
