import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import {
  TRACK_CENTERLINE,
  TRACK_NAME,
  TRACK_WIDTH,
  type Vec2
} from "@bumpshift/shared";

interface TrackFrame {
  point: Vector3;
  tangent: Vector3;
  normal: Vector3;
}

const pointAt = (index: number): Vec2 => {
  const point =
    TRACK_CENTERLINE[
      (index + TRACK_CENTERLINE.length) % TRACK_CENTERLINE.length
    ];
  if (!point) {
    throw new Error("Le circuit ne contient aucun point.");
  }
  return point;
};

const frameAt = (index: number): TrackFrame => {
  const previous = pointAt(index - 1);
  const current = pointAt(index);
  const next = pointAt(index + 1);
  const tangent = new Vector3(
    next.x - previous.x,
    0,
    next.z - previous.z
  ).normalize();

  return {
    point: new Vector3(current.x, 0, current.z),
    tangent,
    normal: new Vector3(-tangent.z, 0, tangent.x)
  };
};

const material = (
  scene: Scene,
  name: string,
  color: string,
  emissive = 0
): StandardMaterial => {
  const result = new StandardMaterial(name, scene);
  const parsed = Color3.FromHexString(color);
  result.diffuseColor = parsed;
  result.specularColor = new Color3(0.12, 0.14, 0.14);
  result.emissiveColor = parsed.scale(emissive);
  return result;
};

const ribbon = (
  scene: Scene,
  name: string,
  halfWidth: number,
  y: number,
  trackMaterial: StandardMaterial
): Mesh => {
  const left: Vector3[] = [];
  const right: Vector3[] = [];

  for (let index = 0; index < TRACK_CENTERLINE.length; index += 1) {
    const frame = frameAt(index);
    left.push(frame.point.add(frame.normal.scale(halfWidth)).add(new Vector3(0, y, 0)));
    right.push(frame.point.subtract(frame.normal.scale(halfWidth)).add(new Vector3(0, y, 0)));
  }

  const mesh = MeshBuilder.CreateRibbon(
    name,
    {
      pathArray: [left, right],
      closePath: true,
      sideOrientation: Mesh.DOUBLESIDE
    },
    scene
  );
  mesh.material = trackMaterial;
  mesh.receiveShadows = true;
  return mesh;
};

const mergeByMaterial = (
  meshes: Mesh[],
  name: string,
  trackMaterial: StandardMaterial
): void => {
  if (meshes.length === 0) {
    return;
  }
  const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
  if (merged) {
    merged.name = name;
    merged.material = trackMaterial;
    merged.receiveShadows = true;
  }
};

const createCurbs = (scene: Scene): void => {
  const white = material(scene, "curb-white", "#eef5f1", 0.03);
  const coral = material(scene, "curb-coral", "#ff5f55", 0.08);
  const whiteMeshes: Mesh[] = [];
  const coralMeshes: Mesh[] = [];
  const step = 2;

  for (let index = 0; index < TRACK_CENTERLINE.length; index += step) {
    const frame = frameAt(index);
    const future = frameAt(index + step);
    const midpoint = frame.point.add(future.point).scale(0.5);
    const depth = Math.max(0.8, Vector3.Distance(frame.point, future.point) * 1.06);
    const heading = Math.atan2(frame.tangent.x, frame.tangent.z);
    const collection = (index / step) % 2 === 0 ? coralMeshes : whiteMeshes;

    for (const side of [-1, 1]) {
      const curb = MeshBuilder.CreateBox(
        "curb-segment",
        {
          width: 0.78,
          height: 0.14,
          depth
        },
        scene
      );
      curb.position = midpoint
        .add(frame.normal.scale(side * (TRACK_WIDTH * 0.5 + 0.28)))
        .add(new Vector3(0, 0.13, 0));
      curb.rotation.y = heading;
      collection.push(curb);
    }
  }

  mergeByMaterial(whiteMeshes, "curbs-white", white);
  mergeByMaterial(coralMeshes, "curbs-coral", coral);
};

const createTrackLights = (scene: Scene): void => {
  const glow = material(scene, "rail-glow", "#4cf4e6", 1);
  glow.disableLighting = true;

  for (const side of [-1, 1]) {
    const path = TRACK_CENTERLINE.map((_point, index) => {
      const frame = frameAt(index);
      return frame.point
        .add(frame.normal.scale(side * (TRACK_WIDTH * 0.5 + 1.08)))
        .add(new Vector3(0, 0.72, 0));
    });
    const first = path[0];
    if (first) {
      path.push(first.clone());
    }
    const rail = MeshBuilder.CreateTube(
      `light-rail-${side}`,
      {
        path,
        radius: 0.055,
        tessellation: 6,
        cap: Mesh.NO_CAP
      },
      scene
    );
    rail.material = glow;
  }
};

const createStartGrid = (scene: Scene): void => {
  const frame = frameAt(0);
  const heading = Math.atan2(frame.tangent.x, frame.tangent.z);
  const white = material(scene, "grid-white", "#f4faf7", 0.08);
  const dark = material(scene, "grid-dark", "#101619");
  const whiteMeshes: Mesh[] = [];
  const darkMeshes: Mesh[] = [];
  const columns = 10;
  const rows = 2;
  const tileWidth = TRACK_WIDTH / columns;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const tile = MeshBuilder.CreateBox(
        "grid-tile",
        { width: tileWidth, height: 0.035, depth: 0.72 },
        scene
      );
      const lateral =
        -TRACK_WIDTH * 0.5 + tileWidth * 0.5 + tileWidth * column;
      tile.position = frame.point
        .add(frame.normal.scale(lateral))
        .add(frame.tangent.scale((row - 0.5) * 0.72))
        .add(new Vector3(0, 0.11, 0));
      tile.rotation.y = heading;
      ((row + column) % 2 === 0 ? whiteMeshes : darkMeshes).push(tile);
    }
  }

  mergeByMaterial(whiteMeshes, "grid-white-merged", white);
  mergeByMaterial(darkMeshes, "grid-dark-merged", dark);
};

const createArch = (
  scene: Scene,
  trackIndex: number,
  primary: boolean
): void => {
  const frame = frameAt(trackIndex);
  const heading = Math.atan2(frame.tangent.x, frame.tangent.z);
  const frameMaterial = material(
    scene,
    primary ? "start-arch" : `checkpoint-${trackIndex}`,
    primary ? "#bafc4b" : "#4cf4e6",
    0.7
  );
  frameMaterial.disableLighting = true;

  for (const side of [-1, 1]) {
    const pillar = MeshBuilder.CreateBox(
      "arch-pillar",
      {
        width: primary ? 0.62 : 0.34,
        height: primary ? 6.8 : 4.8,
        depth: primary ? 0.62 : 0.34
      },
      scene
    );
    pillar.material = frameMaterial;
    pillar.position = frame.point
      .add(frame.normal.scale(side * (TRACK_WIDTH * 0.5 + 1.35)))
      .add(new Vector3(0, primary ? 3.4 : 2.4, 0));
    pillar.rotation.y = heading;
  }

  const beam = MeshBuilder.CreateBox(
    "arch-beam",
    {
      width: TRACK_WIDTH + 3.3,
      height: primary ? 0.55 : 0.28,
      depth: primary ? 0.62 : 0.34
    },
    scene
  );
  beam.material = frameMaterial;
  beam.position = frame.point.add(new Vector3(0, primary ? 6.55 : 4.65, 0));
  beam.rotation.y = heading;

  if (!primary) {
    return;
  }

  const texture = new DynamicTexture(
    "start-banner-texture",
    { width: 1024, height: 256 },
    scene,
    false
  );
  texture.hasAlpha = true;
  texture.drawText(
    "BUMPSHIFT",
    null,
    174,
    "italic 900 118px Arial",
    "#f7fbf9",
    "transparent",
    true,
    true
  );
  const bannerMaterial = new StandardMaterial("start-banner-material", scene);
  bannerMaterial.diffuseTexture = texture;
  bannerMaterial.emissiveTexture = texture;
  bannerMaterial.opacityTexture = texture;
  bannerMaterial.disableLighting = true;
  bannerMaterial.backFaceCulling = false;

  const banner = MeshBuilder.CreatePlane(
    "start-banner",
    { width: 10.8, height: 2.3 },
    scene
  );
  banner.material = bannerMaterial;
  banner.position = frame.point
    .add(frame.tangent.scale(0.34))
    .add(new Vector3(0, 5.55, 0));
  banner.rotation.y = heading;
}

const createScenery = (scene: Scene): void => {
  const rockMaterial = material(scene, "rocks", "#102621");
  const rockMeshes: Mesh[] = [];

  for (let index = 0; index < 42; index += 1) {
    const angle = (index / 42) * Math.PI * 2;
    const radius = 88 + ((index * 29) % 31);
    const rock = MeshBuilder.CreatePolyhedron(
      "rock",
      { type: index % 3, size: 2.2 + (index % 5) * 0.55 },
      scene
    );
    rock.position.set(
      Math.cos(angle) * radius,
      0.8 + (index % 3) * 0.35,
      Math.sin(angle) * radius
    );
    rock.rotation.set(index * 0.21, index * 0.47, index * 0.13);
    rock.scaling.y = 1.2 + (index % 4) * 0.35;
    rockMeshes.push(rock);
  }

  mergeByMaterial(rockMeshes, "rocks-merged", rockMaterial);

  const pylonMaterial = material(scene, "pylon-glow", "#bafc4b", 0.8);
  pylonMaterial.disableLighting = true;
  const pylonMeshes: Mesh[] = [];

  for (let index = 0; index < 24; index += 1) {
    const angle = (index / 24) * Math.PI * 2 + 0.13;
    const radius = 102;
    const pylon = MeshBuilder.CreateCylinder(
      "pylon",
      {
        diameter: 0.16,
        height: 4 + (index % 4) * 1.2,
        tessellation: 6
      },
      scene
    );
    pylon.position.set(
      Math.cos(angle) * radius,
      pylon.getBoundingInfo().boundingBox.extendSize.y,
      Math.sin(angle) * radius
    );
    pylonMeshes.push(pylon);
  }

  mergeByMaterial(pylonMeshes, "pylons-merged", pylonMaterial);
};

export function createTrackVisual(scene: Scene): void {
  const groundMaterial = material(scene, "ground", "#071a17");
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: 280, height: 280, subdivisions: 1 },
    scene
  );
  ground.material = groundMaterial;
  ground.position.y = -0.08;
  ground.receiveShadows = true;

  const shoulderMaterial = material(scene, "shoulder", "#27352f");
  const roadMaterial = material(scene, "asphalt", "#1a2025");
  roadMaterial.specularColor = new Color3(0.2, 0.22, 0.23);

  ribbon(
    scene,
    "track-shoulder",
    TRACK_WIDTH * 0.5 + 1.32,
    0.015,
    shoulderMaterial
  );
  ribbon(scene, "track-road", TRACK_WIDTH * 0.5, 0.055, roadMaterial);

  const centerlinePoints = TRACK_CENTERLINE.map(
    (point) => new Vector3(point.x, 0.095, point.z)
  );
  const first = centerlinePoints[0];
  if (first) {
    centerlinePoints.push(first.clone());
  }
  const centerline = MeshBuilder.CreateDashedLines(
    "centerline",
    {
      points: centerlinePoints,
      dashSize: 0.8,
      gapSize: 2.6,
      dashNb: TRACK_CENTERLINE.length
    },
    scene
  );
  centerline.color = new Color3(0.64, 0.72, 0.69);
  centerline.alpha = 0.34;

  createCurbs(scene);
  createTrackLights(scene);
  createStartGrid(scene);
  createArch(scene, 0, true);
  createArch(scene, Math.floor(TRACK_CENTERLINE.length * 0.26), false);
  createArch(scene, Math.floor(TRACK_CENTERLINE.length * 0.53), false);
  createArch(scene, Math.floor(TRACK_CENTERLINE.length * 0.78), false);
  createScenery(scene);

  scene.metadata = {
    ...scene.metadata,
    trackName: TRACK_NAME
  };
}
