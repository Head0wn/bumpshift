import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import {
  getTrackDefinition,
  projectToTrack,
  type TrackDefinition,
  type TrackId,
  type Vec2
} from "@bumpshift/shared";

interface TrackFrame {
  point: Vector3;
  tangent: Vector3;
  normal: Vector3;
}

interface TrackPalette {
  ground: string;
  shoulder: string;
  road: string;
  accent: string;
  secondary: string;
  curb: string;
}

export interface TrackVisualHandle {
  readonly trackId: TrackId;
  dispose(): void;
}

const PALETTES: Record<TrackId, TrackPalette> = {
  aurora: {
    ground: "#071a17",
    shoulder: "#27352f",
    road: "#1a2025",
    accent: "#4cf4e6",
    secondary: "#bafc4b",
    curb: "#ff5f55"
  },
  "riviera-royale": {
    ground: "#102129",
    shoulder: "#d9cbb4",
    road: "#272c32",
    accent: "#42d7ff",
    secondary: "#ffd66b",
    curb: "#ff5f55"
  }
};

const pointAt = (track: TrackDefinition, index: number): Vec2 => {
  const point =
    track.centerline[
      (index + track.centerline.length) % track.centerline.length
    ];
  if (!point) {
    throw new Error("Le circuit ne contient aucun point.");
  }
  return point;
};

const frameAt = (track: TrackDefinition, index: number): TrackFrame => {
  const previous = pointAt(track, index - 1);
  const current = pointAt(track, index);
  const next = pointAt(track, index + 1);
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
  track: TrackDefinition,
  name: string,
  halfWidth: number,
  y: number,
  trackMaterial: StandardMaterial
): Mesh => {
  const left: Vector3[] = [];
  const right: Vector3[] = [];

  for (let index = 0; index < track.centerline.length; index += 1) {
    const frame = frameAt(track, index);
    left.push(
      frame.point.add(frame.normal.scale(halfWidth)).add(new Vector3(0, y, 0))
    );
    right.push(
      frame.point
        .subtract(frame.normal.scale(halfWidth))
        .add(new Vector3(0, y, 0))
    );
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
): Mesh | null => {
  if (meshes.length === 0) {
    return null;
  }
  const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
  if (merged) {
    merged.name = name;
    merged.material = trackMaterial;
    merged.receiveShadows = true;
  }
  return merged;
};

const createCurbs = (
  scene: Scene,
  track: TrackDefinition,
  palette: TrackPalette
): void => {
  const white = material(scene, "curb-white", "#eef5f1", 0.03);
  const color = material(scene, "curb-color", palette.curb, 0.08);
  const whiteMeshes: Mesh[] = [];
  const colorMeshes: Mesh[] = [];
  const step = track.id === "riviera-royale" ? 3 : 2;

  for (let index = 0; index < track.centerline.length; index += step) {
    const frame = frameAt(track, index);
    const future = frameAt(track, index + step);
    const midpoint = frame.point.add(future.point).scale(0.5);
    const depth = Math.max(
      0.8,
      Vector3.Distance(frame.point, future.point) * 1.06
    );
    const heading = Math.atan2(frame.tangent.x, frame.tangent.z);
    const collection = (index / step) % 2 === 0 ? colorMeshes : whiteMeshes;

    for (const side of [-1, 1]) {
      const curb = MeshBuilder.CreateBox(
        "curb-segment",
        {
          width: 0.72,
          height: 0.14,
          depth
        },
        scene
      );
      curb.position = midpoint
        .add(frame.normal.scale(side * (track.width * 0.5 + 0.25)))
        .add(new Vector3(0, 0.13, 0));
      curb.rotation.y = heading;
      collection.push(curb);
    }
  }

  mergeByMaterial(whiteMeshes, "curbs-white", white);
  mergeByMaterial(colorMeshes, "curbs-color", color);
};

const createTrackRails = (
  scene: Scene,
  track: TrackDefinition,
  palette: TrackPalette
): void => {
  const railMaterial = material(scene, "rail-dark", "#273239");
  const glow = material(scene, "rail-glow", palette.accent, 1);
  glow.disableLighting = true;

  for (const side of [-1, 1]) {
    const lowPath = track.centerline.map((_point, index) => {
      const frame = frameAt(track, index);
      return frame.point
        .add(frame.normal.scale(side * (track.width * 0.5 + 0.95)))
        .add(new Vector3(0, 0.66, 0));
    });
    const glowPath = lowPath.map((point) =>
      point.add(new Vector3(0, 0.5, 0))
    );
    const lowFirst = lowPath[0];
    const glowFirst = glowPath[0];
    if (lowFirst) {
      lowPath.push(lowFirst.clone());
    }
    if (glowFirst) {
      glowPath.push(glowFirst.clone());
    }

    const barrier = MeshBuilder.CreateTube(
      `barrier-${side}`,
      {
        path: lowPath,
        radius: track.id === "riviera-royale" ? 0.12 : 0.08,
        tessellation: 6,
        cap: Mesh.NO_CAP
      },
      scene
    );
    barrier.material = railMaterial;

    const rail = MeshBuilder.CreateTube(
      `light-rail-${side}`,
      {
        path: glowPath,
        radius: 0.05,
        tessellation: 6,
        cap: Mesh.NO_CAP
      },
      scene
    );
    rail.material = glow;
  }
};

const createStartGrid = (
  scene: Scene,
  track: TrackDefinition
): void => {
  const frame = frameAt(track, 0);
  const heading = Math.atan2(frame.tangent.x, frame.tangent.z);
  const white = material(scene, "grid-white", "#f4faf7", 0.08);
  const dark = material(scene, "grid-dark", "#101619");
  const whiteMeshes: Mesh[] = [];
  const darkMeshes: Mesh[] = [];
  const columns = 10;
  const rows = 2;
  const tileWidth = track.width / columns;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const tile = MeshBuilder.CreateBox(
        "grid-tile",
        { width: tileWidth, height: 0.035, depth: 0.72 },
        scene
      );
      const lateral =
        -track.width * 0.5 + tileWidth * 0.5 + tileWidth * column;
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
  track: TrackDefinition,
  trackIndex: number,
  primary: boolean,
  palette: TrackPalette
): void => {
  const frame = frameAt(track, trackIndex);
  const heading = Math.atan2(frame.tangent.x, frame.tangent.z);
  const frameMaterial = material(
    scene,
    primary ? "start-arch" : `checkpoint-${trackIndex}`,
    primary ? palette.secondary : palette.accent,
    0.7
  );
  frameMaterial.disableLighting = true;

  for (const side of [-1, 1]) {
    const pillar = MeshBuilder.CreateBox(
      "arch-pillar",
      {
        width: primary ? 0.62 : 0.3,
        height: primary ? 6.8 : 4.2,
        depth: primary ? 0.62 : 0.3
      },
      scene
    );
    pillar.material = frameMaterial;
    pillar.position = frame.point
      .add(frame.normal.scale(side * (track.width * 0.5 + 1.2)))
      .add(new Vector3(0, primary ? 3.4 : 2.1, 0));
    pillar.rotation.y = heading;
  }

  const beam = MeshBuilder.CreateBox(
    "arch-beam",
    {
      width: track.width + 3,
      height: primary ? 0.55 : 0.24,
      depth: primary ? 0.62 : 0.3
    },
    scene
  );
  beam.material = frameMaterial;
  beam.position = frame.point.add(new Vector3(0, primary ? 6.55 : 4.05, 0));
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
    track.name.toUpperCase(),
    null,
    172,
    "italic 900 104px Arial",
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
};

const createAuroraScenery = (scene: Scene, track: TrackDefinition): void => {
  const rockMaterial = material(scene, "rocks", "#102621");
  const trunkMaterial = material(scene, "tree-trunks", "#17211c");
  const foliageMaterial = material(scene, "tree-foliage", "#153b31");
  const rockMeshes: Mesh[] = [];
  const trunks: Mesh[] = [];
  const foliage: Mesh[] = [];

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

  for (let index = 0; index < 48; index += 1) {
    const sampleIndex =
      (index * 17 + 9) % track.centerline.length;
    const frame = frameAt(track, sampleIndex);
    const side = index % 2 === 0 ? -1 : 1;
    const distance = track.width * 0.5 + 7 + (index % 5) * 2.2;
    const position = frame.point.add(frame.normal.scale(side * distance));
    const height = 3.6 + (index % 6) * 0.48;

    const trunk = MeshBuilder.CreateCylinder(
      "pine-trunk",
      { diameter: 0.3, height, tessellation: 6 },
      scene
    );
    trunk.position = position.add(new Vector3(0, height * 0.5, 0));
    trunks.push(trunk);

    const crown = MeshBuilder.CreateCylinder(
      "pine-crown",
      {
        diameterTop: 0.12,
        diameterBottom: 2.5 + (index % 3) * 0.35,
        height: height * 0.85,
        tessellation: 7
      },
      scene
    );
    crown.position = position.add(new Vector3(0, height * 0.8, 0));
    foliage.push(crown);
  }

  mergeByMaterial(rockMeshes, "rocks-merged", rockMaterial);
  mergeByMaterial(trunks, "tree-trunks-merged", trunkMaterial);
  mergeByMaterial(foliage, "tree-foliage-merged", foliageMaterial);
};

const createTunnel = (
  scene: Scene,
  track: TrackDefinition,
  palette: TrackPalette
): void => {
  const wallMaterial = material(scene, "tunnel-wall", "#aeb3b3");
  const ceilingMaterial = material(scene, "tunnel-ceiling", "#263037");
  const lightMaterial = material(scene, "tunnel-lights", palette.secondary, 1);
  lightMaterial.disableLighting = true;
  const walls: Mesh[] = [];
  const ceilings: Mesh[] = [];
  const lights: Mesh[] = [];
  const start = Math.floor(track.centerline.length * 0.64);
  const end = Math.floor(track.centerline.length * 0.77);
  const step = 3;

  for (let index = start; index < end; index += step) {
    const frame = frameAt(track, index);
    const future = frameAt(track, Math.min(end, index + step));
    const midpoint = frame.point.add(future.point).scale(0.5);
    const depth = Vector3.Distance(frame.point, future.point) * 1.08;
    const heading = Math.atan2(frame.tangent.x, frame.tangent.z);

    for (const side of [-1, 1]) {
      const wall = MeshBuilder.CreateBox(
        "tunnel-wall-segment",
        { width: 0.55, height: 4.6, depth },
        scene
      );
      wall.position = midpoint
        .add(frame.normal.scale(side * (track.width * 0.5 + 0.5)))
        .add(new Vector3(0, 2.3, 0));
      wall.rotation.y = heading;
      walls.push(wall);
    }

    const ceiling = MeshBuilder.CreateBox(
      "tunnel-ceiling-segment",
      { width: track.width + 1.6, height: 0.35, depth },
      scene
    );
    ceiling.position = midpoint.add(new Vector3(0, 4.55, 0));
    ceiling.rotation.y = heading;
    ceilings.push(ceiling);

    const light = MeshBuilder.CreateBox(
      "tunnel-light",
      { width: 0.16, height: 0.05, depth: Math.max(0.8, depth * 0.45) },
      scene
    );
    light.position = midpoint.add(new Vector3(0, 4.32, 0));
    light.rotation.y = heading;
    lights.push(light);
  }

  mergeByMaterial(walls, "tunnel-walls-merged", wallMaterial);
  mergeByMaterial(ceilings, "tunnel-ceiling-merged", ceilingMaterial);
  mergeByMaterial(lights, "tunnel-lights-merged", lightMaterial);
};

const createRivieraScenery = (
  scene: Scene,
  track: TrackDefinition,
  palette: TrackPalette
): void => {
  const buildingColors = [
    "#e8d7bb",
    "#f0c7a7",
    "#c8d7d4",
    "#d7c7dd"
  ] as const;
  const buildingMaterials = buildingColors.map((color, index) =>
    material(scene, `building-${index}`, color, 0.015)
  );
  const windowMaterial = material(scene, "windows", "#ffe7a3", 0.75);
  const buildings: Mesh[][] = buildingMaterials.map(() => []);
  const windows: Mesh[] = [];

  for (let index = 0; index < 56; index += 1) {
    const angle = (index / 56) * Math.PI * 2 + 0.08;
    const radius = 73 + (index % 7) * 5.2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const projection = projectToTrack(x, z, track.id);
    if (projection.distance < track.width * 0.5 + 7) {
      continue;
    }

    const width = 5 + (index % 4) * 1.2;
    const depth = 4.5 + ((index + 2) % 4) * 1.1;
    const height = 7 + (index % 8) * 2.1;
    const building = MeshBuilder.CreateBox(
      "riviera-building",
      { width, height, depth },
      scene
    );
    building.position.set(x, height * 0.5, z);
    building.rotation.y = angle + (index % 3) * 0.16;
    buildings[index % buildingMaterials.length]?.push(building);

    const window = MeshBuilder.CreateBox(
      "riviera-window-strip",
      { width: width * 0.62, height: 0.22, depth: depth + 0.03 },
      scene
    );
    window.position.set(x, height * 0.7, z);
    window.rotation.y = building.rotation.y;
    windows.push(window);
  }

  buildingMaterials.forEach((buildingMaterial, index) => {
    mergeByMaterial(
      buildings[index] ?? [],
      `riviera-buildings-${index}`,
      buildingMaterial
    );
  });
  mergeByMaterial(windows, "riviera-windows-merged", windowMaterial);

  const waterMaterial = material(scene, "harbor-water", "#07516a", 0.16);
  waterMaterial.alpha = 0.92;
  const water = MeshBuilder.CreateGround(
    "harbor-water",
    { width: 82, height: 38, subdivisions: 1 },
    scene
  );
  water.material = waterMaterial;
  water.position.set(19, -0.03, -72);

  const yachtMaterial = material(scene, "yachts", "#f4f7f4", 0.05);
  const yachtAccent = material(scene, "yacht-windows", "#183642", 0.2);
  const hulls: Mesh[] = [];
  const cabins: Mesh[] = [];
  for (let index = 0; index < 9; index += 1) {
    const hull = MeshBuilder.CreateBox(
      "yacht-hull",
      {
        width: 2.2 + (index % 3) * 0.45,
        height: 0.55,
        depth: 5.8 + (index % 2) * 1.3
      },
      scene
    );
    hull.position.set(-8 + index * 6.8, 0.28, -68 - (index % 2) * 7);
    hull.rotation.y = index % 2 === 0 ? 0.08 : -0.08;
    hulls.push(hull);

    const cabin = MeshBuilder.CreateBox(
      "yacht-cabin",
      { width: 1.45, height: 0.65, depth: 2.15 },
      scene
    );
    cabin.position = hull.position.add(new Vector3(0, 0.58, -0.4));
    cabin.rotation.y = hull.rotation.y;
    cabins.push(cabin);
  }
  mergeByMaterial(hulls, "yacht-hulls-merged", yachtMaterial);
  mergeByMaterial(cabins, "yacht-cabins-merged", yachtAccent);

  const palmTrunk = material(scene, "palm-trunks", "#6c5034");
  const palmLeaf = material(scene, "palm-leaves", "#2c775a");
  const trunks: Mesh[] = [];
  const leaves: Mesh[] = [];
  for (let index = 0; index < 18; index += 1) {
    const sampleIndex = (index * 19 + 20) % track.centerline.length;
    const frame = frameAt(track, sampleIndex);
    const side = index % 2 === 0 ? 1 : -1;
    const position = frame.point.add(
      frame.normal.scale(side * (track.width * 0.5 + 5.2))
    );
    const height = 4.1 + (index % 3) * 0.45;
    const trunk = MeshBuilder.CreateCylinder(
      "palm-trunk",
      { diameterTop: 0.18, diameterBottom: 0.32, height, tessellation: 7 },
      scene
    );
    trunk.position = position.add(new Vector3(0, height * 0.5, 0));
    trunks.push(trunk);

    for (let leafIndex = 0; leafIndex < 4; leafIndex += 1) {
      const leaf = MeshBuilder.CreateBox(
        "palm-leaf",
        { width: 0.16, height: 0.08, depth: 2.2 },
        scene
      );
      leaf.position = position.add(new Vector3(0, height, 0));
      leaf.rotation.y = (leafIndex / 4) * Math.PI * 2;
      leaf.rotation.x = 0.22;
      leaves.push(leaf);
    }
  }
  mergeByMaterial(trunks, "palm-trunks-merged", palmTrunk);
  mergeByMaterial(leaves, "palm-leaves-merged", palmLeaf);

  createTunnel(scene, track, palette);
};

export function createTrackVisual(
  scene: Scene,
  trackId: TrackId
): TrackVisualHandle {
  const track = getTrackDefinition(trackId);
  const palette = PALETTES[track.id];
  const existingMeshes = new Set(scene.meshes);
  const existingMaterials = new Set(scene.materials);
  const existingTextures = new Set(scene.textures);

  const groundMaterial = material(scene, "ground", palette.ground);
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: 300, height: 300, subdivisions: 1 },
    scene
  );
  ground.material = groundMaterial;
  ground.position.y = -0.08;
  ground.receiveShadows = true;

  const shoulderMaterial = material(scene, "shoulder", palette.shoulder);
  const roadMaterial = material(scene, "asphalt", palette.road);
  roadMaterial.specularColor = new Color3(0.2, 0.22, 0.23);

  ribbon(
    scene,
    track,
    "track-shoulder",
    track.width * 0.5 + 1.32,
    0.015,
    shoulderMaterial
  );
  ribbon(
    scene,
    track,
    "track-road",
    track.width * 0.5,
    0.055,
    roadMaterial
  );

  const centerlinePoints = track.centerline.map(
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
      dashNb: track.centerline.length
    },
    scene
  );
  centerline.color = new Color3(0.64, 0.72, 0.69);
  centerline.alpha = track.id === "riviera-royale" ? 0.5 : 0.34;

  createCurbs(scene, track, palette);
  createTrackRails(scene, track, palette);
  createStartGrid(scene, track);
  createArch(scene, track, 0, true, palette);
  for (const progress of [0.25, 0.5, 0.75]) {
    createArch(
      scene,
      track,
      Math.floor(track.centerline.length * progress),
      false,
      palette
    );
  }

  if (track.id === "riviera-royale") {
    createRivieraScenery(scene, track, palette);
  } else {
    createAuroraScenery(scene, track);
  }

  scene.metadata = {
    ...scene.metadata,
    trackId: track.id,
    trackName: track.name
  };

  const createdMeshes = scene.meshes.filter((mesh) => !existingMeshes.has(mesh));
  const createdMaterials = scene.materials.filter(
    (trackMaterial) => !existingMaterials.has(trackMaterial)
  );
  const createdTextures = scene.textures.filter(
    (texture) => !existingTextures.has(texture)
  );
  let disposed = false;

  return {
    trackId: track.id,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const mesh of createdMeshes) {
        mesh.dispose(false, false);
      }
      for (const trackMaterial of createdMaterials) {
        trackMaterial.dispose(false, false);
      }
      for (const texture of createdTextures) {
        texture.dispose();
      }
    }
  };
}
