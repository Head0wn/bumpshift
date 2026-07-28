import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { KartState } from "@bumpshift/shared";

const KART_COLORS = [
  "#bafc4b",
  "#4cf4e6",
  "#ff5f55",
  "#9d7cff",
  "#ffcb44",
  "#4b92ff",
  "#ff70c8",
  "#f2f5f2"
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
  const material = new StandardMaterial(name, scene);
  const color = Color3.FromHexString(diffuse);
  material.diffuseColor = color;
  material.specularColor = new Color3(0.4, 0.4, 0.4);
  material.emissiveColor = color.scale(emissiveIntensity);
  return material;
};

export class KartVisual {
  readonly root: TransformNode;

  private readonly bodyPivot: TransformNode;
  private readonly wheels: Mesh[] = [];
  private readonly sparks: Mesh[] = [];
  private readonly boostFlames: Mesh[] = [];
  private wheelRotation = 0;
  private readonly accentMaterial: StandardMaterial;

  constructor(scene: Scene, colorIndex: number) {
    const visualId = ++visualSequence;
    const accent =
      KART_COLORS[colorIndex % KART_COLORS.length] ?? KART_COLORS[0];
    const accentMaterial = makeMaterial(
      scene,
      `kart-accent-${visualId}`,
      accent,
      0.08
    );
    const darkMaterial = makeMaterial(
      scene,
      `kart-dark-${visualId}`,
      "#11181d"
    );
    const glassMaterial = makeMaterial(
      scene,
      `kart-glass-${visualId}`,
      "#83dbe0",
      0.16
    );
    glassMaterial.alpha = 0.8;
    const tireMaterial = makeMaterial(
      scene,
      `kart-tire-${visualId}`,
      "#080b0d"
    );
    const glowMaterial = makeMaterial(
      scene,
      `kart-glow-${visualId}`,
      "#4cf4e6",
      1
    );
    glowMaterial.disableLighting = true;

    this.accentMaterial = accentMaterial;
    this.root = new TransformNode("kart-root", scene);
    this.bodyPivot = new TransformNode("kart-body-pivot", scene);
    this.bodyPivot.parent = this.root;

    const shadow = MeshBuilder.CreateDisc(
      "kart-shadow",
      { radius: 1.45, tessellation: 24 },
      scene
    );
    const shadowMaterial = makeMaterial(
      scene,
      `kart-shadow-${visualId}`,
      "#000000"
    );
    shadowMaterial.alpha = 0.34;
    shadowMaterial.disableLighting = true;
    shadow.material = shadowMaterial;
    shadow.rotation.x = Math.PI / 2;
    shadow.scaling.y = 0.58;
    shadow.position.y = 0.05;
    shadow.parent = this.root;

    const chassis = MeshBuilder.CreateBox(
      "kart-chassis",
      { width: 1.82, height: 0.5, depth: 2.85 },
      scene
    );
    chassis.material = darkMaterial;
    chassis.position.y = 0.58;
    chassis.parent = this.bodyPivot;

    const body = MeshBuilder.CreateBox(
      "kart-body",
      { width: 1.62, height: 0.42, depth: 2.2 },
      scene
    );
    body.material = accentMaterial;
    body.position.set(0, 0.86, 0.1);
    body.parent = this.bodyPivot;

    const nose = MeshBuilder.CreateBox(
      "kart-nose",
      { width: 1.48, height: 0.26, depth: 0.86 },
      scene
    );
    nose.material = accentMaterial;
    nose.position.set(0, 0.68, 1.46);
    nose.scaling.x = 0.86;
    nose.parent = this.bodyPivot;

    const cockpit = MeshBuilder.CreateSphere(
      "kart-cockpit",
      {
        diameterX: 0.96,
        diameterY: 0.72,
        diameterZ: 1.18,
        segments: 16
      },
      scene
    );
    cockpit.material = glassMaterial;
    cockpit.position.set(0, 1.2, -0.15);
    cockpit.parent = this.bodyPivot;

    const rearWing = MeshBuilder.CreateBox(
      "kart-wing",
      { width: 2.06, height: 0.16, depth: 0.4 },
      scene
    );
    rearWing.material = accentMaterial;
    rearWing.position.set(0, 1.08, -1.42);
    rearWing.parent = this.bodyPivot;

    for (const x of [-0.96, 0.96]) {
      for (const z of [-0.95, 0.95]) {
        const wheel = MeshBuilder.CreateCylinder(
          "kart-wheel",
          { diameter: 0.72, height: 0.38, tessellation: 14 },
          scene
        );
        wheel.material = tireMaterial;
        wheel.position.set(x, 0.48, z);
        wheel.rotation.z = Math.PI / 2;
        wheel.parent = this.bodyPivot;
        this.wheels.push(wheel);
      }
    }

    for (const x of [-0.48, 0.48]) {
      const spark = MeshBuilder.CreateSphere(
        "drift-spark",
        { diameter: 0.2, segments: 8 },
        scene
      );
      spark.material = glowMaterial;
      spark.position.set(x, 0.33, -1.42);
      spark.parent = this.bodyPivot;
      spark.setEnabled(false);
      this.sparks.push(spark);

      const flame = MeshBuilder.CreateCylinder(
        "boost-flame",
        {
          diameterTop: 0.08,
          diameterBottom: 0.34,
          height: 0.8,
          tessellation: 10
        },
        scene
      );
      flame.material = glowMaterial;
      flame.position.set(x, 0.62, -1.75);
      flame.rotation.x = Math.PI / 2;
      flame.parent = this.bodyPivot;
      flame.setEnabled(false);
      this.boostFlames.push(flame);
    }
  }

  update(state: Readonly<KartState>, deltaSeconds: number, snap = false): void {
    const amount = snap ? 1 : 1 - Math.exp(-deltaSeconds * 13);
    const targetPosition = new Vector3(state.x, 0.09, state.z);
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

    const leanTarget = -state.steer * Math.min(0.12, Math.abs(state.speed) * 0.004);
    this.bodyPivot.rotation.z +=
      (leanTarget - this.bodyPivot.rotation.z) *
      (1 - Math.exp(-deltaSeconds * 8));

    this.wheelRotation += state.speed * deltaSeconds / 0.36;
    for (const wheel of this.wheels) {
      wheel.rotation.y = this.wheelRotation;
    }

    const chargeRatio = clamp01(state.driftCharge / 1.25);
    const sparkColor =
      chargeRatio > 0.78
        ? Color3.FromHexString("#ff5f55")
        : chargeRatio > 0.42
          ? Color3.FromHexString("#bafc4b")
          : Color3.FromHexString("#4cf4e6");

    for (const [index, spark] of this.sparks.entries()) {
      spark.setEnabled(state.drifting);
      const pulse = 0.8 + Math.sin(performance.now() * 0.025 + index) * 0.25;
      spark.scaling.setAll(pulse * (0.65 + chargeRatio));
      const material = spark.material as StandardMaterial;
      material.emissiveColor = sparkColor;
      material.diffuseColor = sparkColor;
    }

    for (const [index, flame] of this.boostFlames.entries()) {
      flame.setEnabled(state.boostTime > 0);
      const pulse = 0.8 + Math.sin(performance.now() * 0.04 + index) * 0.15;
      flame.scaling.y = pulse;
    }

    this.accentMaterial.emissiveColor =
      state.boostTime > 0
        ? this.accentMaterial.diffuseColor.scale(0.28)
        : this.accentMaterial.diffuseColor.scale(0.08);
  }

  dispose(): void {
    this.root.dispose(false, true);
  }
}
