import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import {
  getTrackDefinition,
  projectToTrack,
  trackHeightAtProgress,
  type TrackDefinition,
  type TrackId,
  type Vec2
} from "@bumpshift/shared";

interface TrackFrame {
  point: Vector3;
  tangent: Vector3;
  normal: Vector3;
  progress: number;
}

interface TrackPalette {
  skyTop: string;
  skyBottom: string;
  fog: string;
  ground: string;
  groundDetail: string;
  shoulder: string;
  road: string;
  roadDetail: string;
  curb: string;
  barrier: string;
  barrierAccent: string;
  highlight: string;
  water: string;
}

export interface TrackVisualHandle {
  readonly trackId: TrackId;
  readonly meshes: readonly AbstractMesh[];
  dispose(): void;
}

const PALETTES: Record<TrackId, TrackPalette> = {
  aurora: {
    skyTop: "#5a9fcf",
    skyBottom: "#d7eee0",
    fog: "#b7d7c5",
    ground: "#426b3f",
    groundDetail: "#6f8e4b",
    shoulder: "#7e7659",
    road: "#343b3d",
    roadDetail: "#566063",
    curb: "#d84c3f",
    barrier: "#d4d9d5",
    barrierAccent: "#355b4f",
    highlight: "#f4d35e",
    water: "#2e7994"
  },
  "riviera-royale": {
    skyTop: "#55a8dc",
    skyBottom: "#f3d8ad",
    fog: "#c9d9d5",
    ground: "#b89a67",
    groundDetail: "#d0b87c",
    shoulder: "#b9ae97",
    road: "#3d4145",
    roadDetail: "#656b6d",
    curb: "#cf4038",
    barrier: "#e5dfd2",
    barrierAccent: "#2f6b8a",
    highlight: "#f0b84a",
    water: "#227c9d"
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
  const length = track.centerline.length;
  const normalizedIndex = (index + length) % length;
  const previous = pointAt(track, normalizedIndex - 1);
  const current = pointAt(track, normalizedIndex);
  const next = pointAt(track, normalizedIndex + 1);
  const progress = normalizedIndex / length;
  const previousProgress = ((normalizedIndex - 1 + length) % length) / length;
  const nextProgress = ((normalizedIndex + 1) % length) / length;
  const previousHeight = trackHeightAtProgress(track.id, previousProgress);
  const nextHeight = trackHeightAtProgress(track.id, nextProgress);
  const tangent = new Vector3(
    next.x - previous.x,
    nextHeight - previousHeight,
    next.z - previous.z
  ).normalize();
  const horizontalLength = Math.max(
    0.0001,
    Math.hypot(next.x - previous.x, next.z - previous.z)
  );

  return {
    point: new Vector3(
      current.x,
      trackHeightAtProgress(track.id, progress),
      current.z
    ),
    tangent,
    normal: new Vector3(
      -(next.z - previous.z) / horizontalLength,
      0,
      (next.x - previous.x) / horizontalLength
    ),
    progress
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
  result.specularColor = new Color3(0.18, 0.2, 0.2);
  result.specularPower = 48;
  result.emissiveColor = parsed.scale(emissive);
  return result;
};

const patternTexture = (
  scene: Scene,
  name: string,
  base: string,
  detail: string,
  dense = false
): DynamicTexture => {
  const texture = new DynamicTexture(
    name,
    { width: 256, height: 256 },
    scene,
    false
  );
  const context = texture.getContext();
  context.fillStyle = base;
  context.fillRect(0, 0, 256, 256);
  context.fillStyle = detail;
  const count = dense ? 620 : 180;
  for (let index = 0; index < count; index += 1) {
    const x = (index * 73 + (index % 11) * 19) % 256;
    const y = (index * 137 + (index % 7) * 23) % 256;
    const size = dense ? 1 + (index % 2) : 1 + (index % 4);
    context.globalAlpha = dense ? 0.13 : 0.17;
    context.fillRect(x, y, size, size);
  }
  context.globalAlpha = 1;
  texture.update(false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = dense ? 16 : 9;
  texture.vScale = dense ? 16 : 9;
  return texture;
};

const createSky = (
  scene: Scene,
  palette: TrackPalette
): void => {
  const skyTexture = new DynamicTexture(
    "sky-gradient",
    { width: 32, height: 512 },
    scene,
    false
  );
  const context = skyTexture.getContext();
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, palette.skyTop);
  gradient.addColorStop(0.58, palette.skyBottom);
  gradient.addColorStop(1, palette.fog);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 512);
  skyTexture.update(false);

  const skyMaterial = new StandardMaterial("sky-material", scene);
  skyMaterial.diffuseTexture = skyTexture;
  skyMaterial.emissiveTexture = skyTexture;
  skyMaterial.disableLighting = true;
  skyMaterial.backFaceCulling = false;

  const sky = MeshBuilder.CreateSphere(
    "sky",
    {
      diameter: 340,
      segments: 24,
      sideOrientation: Mesh.BACKSIDE
    },
    scene
  );
  sky.material = skyMaterial;
  sky.position.y = 26;
  sky.isPickable = false;
  sky.infiniteDistance = true;

  const sunMaterial = material(
    scene,
    "sun-material",
    "#fff2c0",
    1
  );
  sunMaterial.disableLighting = true;
  const sun = MeshBuilder.CreateDisc(
    "sun-disc",
    { radius: 9, tessellation: 48 },
    scene
  );
  sun.material = sunMaterial;
  sun.position.set(-92, 72, 118);
  sun.rotation.y = Math.PI;
  sun.isPickable = false;
};

const ribbon = (
  scene: Scene,
  track: TrackDefinition,
  name: string,
  halfWidth: number,
  heightOffset: number,
  trackMaterial: StandardMaterial
): Mesh => {
  const left: Vector3[] = [];
  const right: Vector3[] = [];

  for (let index = 0; index < track.centerline.length; index += 1) {
    const frame = frameAt(track, index);
    const elevation = new Vector3(0, heightOffset, 0);
    left.push(
      frame.point.add(frame.normal.scale(halfWidth)).add(elevation)
    );
    right.push(
      frame.point.subtract(frame.normal.scale(halfWidth)).add(elevation)
    );
  }

  const mesh = MeshBuilder.CreateRibbon(
    name,
    {
      pathArray: [left, right],
      closePath: true,
      sideOrientation: Mesh.DOUBLESIDE,
      updatable: false
    },
    scene
  );
  mesh.material = trackMaterial;
  mesh.receiveShadows = true;
  mesh.isPickable = false;
  return mesh;
};

const createRetainingWalls = (
  scene: Scene,
  track: TrackDefinition,
  palette: TrackPalette
): void => {
  const wallMaterial = material(
    scene,
    "retaining-wall-material",
    Color3.FromHexString(palette.shoulder).scale(0.68).toHexString()
  );
  wallMaterial.specularColor = Color3.Black();

  for (const side of [-1, 1]) {
    const top: Vector3[] = [];
    const bottom: Vector3[] = [];
    for (let index = 0; index < track.centerline.length; index += 1) {
      const frame = frameAt(track, index);
      const edge = frame.point
        .add(frame.normal.scale(side * (track.width * 0.5 + 1.12)))
        .add(new Vector3(0, 0.02, 0));
      top.push(edge);
      bottom.push(new Vector3(edge.x, -0.1, edge.z));
    }

    const wall = MeshBuilder.CreateRibbon(
      `retaining-wall-${side}`,
      {
        pathArray: [top, bottom],
        closePath: true,
        sideOrientation: Mesh.DOUBLESIDE
      },
      scene
    );
    wall.material = wallMaterial;
    wall.receiveShadows = true;
    wall.isPickable = false;
  }
};

const mergeByMaterial = (
  meshes: Mesh[],
  name: string,
  trackMaterial: StandardMaterial,
  receivesShadows = true
): Mesh | null => {
  if (meshes.length === 0) {
    return null;
  }
  const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
  if (merged) {
    merged.name = name;
    merged.material = trackMaterial;
    merged.receiveShadows = receivesShadows;
    merged.isPickable = false;
  }
  return merged;
};

const curvatureAt = (track: TrackDefinition, index: number): number => {
  const before = frameAt(track, index - 4).tangent;
  const after = frameAt(track, index + 4).tangent;
  return before.x * after.z - before.z * after.x;
};

const createCurbs = (
  scene: Scene,
  track: TrackDefinition,
  palette: TrackPalette
): void => {
  const red = material(scene, "curb-red", palette.curb);
  const cream = material(scene, "curb-cream", "#f4eee3");
  const redMeshes: Mesh[] = [];
  const creamMeshes: Mesh[] = [];
  const step = 4;

  for (let index = 0; index < track.centerline.length; index += step) {
    const turn = curvatureAt(track, index);
    if (Math.abs(turn) < 0.055) {
      continue;
    }

    const frame = frameAt(track, index);
    const future = frameAt(track, index + step);
    const midpoint = frame.point.add(future.point).scale(0.5);
    const depth = Vector3.Distance(frame.point, future.point) * 1.06;
    const heading = Math.atan2(frame.tangent.x, frame.tangent.z);
    const side = turn > 0 ? -1 : 1;
    const curb = MeshBuilder.CreateBox(
      "curb-segment",
      {
        width: 0.62,
        height: 0.11,
        depth: Math.max(0.7, depth)
      },
      scene
    );
    curb.position = midpoint
      .add(frame.normal.scale(side * (track.width * 0.5 - 0.19)))
      .add(new Vector3(0, 0.115, 0));
    curb.rotation.y = heading;
    ((index / step) % 2 === 0 ? redMeshes : creamMeshes).push(curb);
  }

  mergeByMaterial(redMeshes, "curbs-red", red);
  mergeByMaterial(creamMeshes, "curbs-cream", cream);
};

const createBarriers = (
  scene: Scene,
  track: TrackDefinition,
  palette: TrackPalette
): void => {
  const baseMaterial = material(scene, "barrier-base", palette.barrier);
  const accentMaterial = material(
    scene,
    "barrier-accent",
    palette.barrierAccent
  );
  const baseMeshes: Mesh[] = [];
  const accentMeshes: Mesh[] = [];
  const posts: Mesh[] = [];
  const postMaterial = material(scene, "barrier-posts", "#5b6262");
  const step = track.id === "riviera-royale" ? 5 : 6;

  for (let index = 0; index < track.centerline.length; index += step) {
    const turn = curvatureAt(track, index);
    if (track.id === "aurora" && Math.abs(turn) < 0.075) {
      continue;
    }

    const frame = frameAt(track, index);
    const future = frameAt(track, index + step);
    const midpoint = frame.point.add(future.point).scale(0.5);
    const depth = Vector3.Distance(frame.point, future.point) * 1.08;
    const heading = Math.atan2(frame.tangent.x, frame.tangent.z);
    const sides =
      track.id === "riviera-royale"
        ? [-1, 1]
        : [turn > 0 ? 1 : -1];

    for (const side of sides) {
      const barrier = MeshBuilder.CreateBox(
        "barrier-panel",
        {
          width: track.id === "riviera-royale" ? 0.34 : 0.2,
          height: track.id === "riviera-royale" ? 0.92 : 0.58,
          depth: Math.max(1.2, depth)
        },
        scene
      );
      barrier.position = midpoint
        .add(frame.normal.scale(side * (track.width * 0.5 + 0.86)))
        .add(
          new Vector3(
            0,
            track.id === "riviera-royale" ? 0.5 : 0.34,
            0
          )
        );
      barrier.rotation.y = heading;
      const accent =
        track.id === "riviera-royale" &&
        (Math.floor(index / step) + (side > 0 ? 2 : 0)) % 9 === 0;
      (accent ? accentMeshes : baseMeshes).push(barrier);

      if (track.id === "aurora") {
        const post = MeshBuilder.CreateBox(
          "guardrail-post",
          { width: 0.16, height: 0.86, depth: 0.16 },
          scene
        );
        post.position = frame.point
          .add(frame.normal.scale(side * (track.width * 0.5 + 0.86)))
          .add(new Vector3(0, 0.42, 0));
        posts.push(post);
      }
    }
  }

  mergeByMaterial(baseMeshes, "barriers-base", baseMaterial);
  mergeByMaterial(accentMeshes, "barriers-accent", accentMaterial);
  mergeByMaterial(posts, "guardrail-posts", postMaterial);
};

const createRoadMarkings = (
  scene: Scene,
  track: TrackDefinition
): void => {
  if (track.id !== "riviera-royale") {
    return;
  }
  const points = track.centerline.map((_point, index) => {
    const frame = frameAt(track, index);
    return frame.point.add(new Vector3(0, 0.13, 0));
  });
  const first = points[0];
  if (first) {
    points.push(first.clone());
  }
  const markings = MeshBuilder.CreateDashedLines(
    "road-markings",
    {
      points,
      dashSize: 1.4,
      gapSize: 4.8,
      dashNb: Math.floor(track.centerline.length * 0.7)
    },
    scene
  );
  markings.color = Color3.FromHexString("#ece8dc");
  markings.alpha = 0.48;
  markings.isPickable = false;
};

const createStartGrid = (
  scene: Scene,
  track: TrackDefinition
): void => {
  const frame = frameAt(track, 0);
  const heading = Math.atan2(frame.tangent.x, frame.tangent.z);
  const white = material(scene, "grid-white", "#f7f4e9");
  const dark = material(scene, "grid-dark", "#24292c");
  const whiteMeshes: Mesh[] = [];
  const darkMeshes: Mesh[] = [];
  const columns = 10;
  const rows = 2;
  const tileWidth = track.width / columns;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const tile = MeshBuilder.CreateBox(
        "grid-tile",
        { width: tileWidth, height: 0.035, depth: 0.7 },
        scene
      );
      const lateral =
        -track.width * 0.5 + tileWidth * 0.5 + tileWidth * column;
      tile.position = frame.point
        .add(frame.normal.scale(lateral))
        .add(frame.tangent.scale((row - 0.5) * 0.7))
        .add(new Vector3(0, 0.14, 0));
      tile.rotation.y = heading;
      ((row + column) % 2 === 0 ? whiteMeshes : darkMeshes).push(tile);
    }
  }

  mergeByMaterial(whiteMeshes, "grid-white-merged", white);
  mergeByMaterial(darkMeshes, "grid-dark-merged", dark);
};

const createStartArch = (
  scene: Scene,
  track: TrackDefinition,
  palette: TrackPalette
): void => {
  const frame = frameAt(track, 0);
  const heading = Math.atan2(frame.tangent.x, frame.tangent.z);
  const frameMaterial = material(
    scene,
    "start-arch-material",
    "#20282b"
  );
  const highlightMaterial = material(
    scene,
    "start-arch-highlight",
    palette.highlight,
    0.15
  );

  for (const side of [-1, 1]) {
    const pillar = MeshBuilder.CreateBox(
      "start-pillar",
      { width: 0.48, height: 5.8, depth: 0.58 },
      scene
    );
    pillar.material = frameMaterial;
    pillar.position = frame.point
      .add(frame.normal.scale(side * (track.width * 0.5 + 1.15)))
      .add(new Vector3(0, 2.9, 0));
    pillar.rotation.y = heading;
  }

  const beam = MeshBuilder.CreateBox(
    "start-beam",
    { width: track.width + 2.8, height: 1.08, depth: 0.62 },
    scene
  );
  beam.material = frameMaterial;
  beam.position = frame.point.add(new Vector3(0, 5.35, 0));
  beam.rotation.y = heading;

  const stripe = MeshBuilder.CreateBox(
    "start-highlight",
    { width: track.width + 2.3, height: 0.12, depth: 0.66 },
    scene
  );
  stripe.material = highlightMaterial;
  stripe.position = frame.point.add(new Vector3(0, 5.67, 0));
  stripe.rotation.y = heading;

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
    168,
    "italic 900 92px Arial",
    "#f7f4e9",
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
    { width: 9.6, height: 1.7 },
    scene
  );
  banner.material = bannerMaterial;
  banner.position = frame.point
    .add(frame.tangent.scale(0.34))
    .add(new Vector3(0, 5.28, 0));
  banner.rotation.y = heading;
};

const safeRoadsidePosition = (
  track: TrackDefinition,
  frame: TrackFrame,
  side: number,
  distance: number
): Vector3 | null => {
  const position = frame.point.add(frame.normal.scale(side * distance));
  const projection = projectToTrack(position.x, position.z, track.id);
  return projection.distance > track.width * 0.5 + 2.2
    ? position
    : null;
};

const createAuroraScenery = (
  scene: Scene,
  track: TrackDefinition
): void => {
  const hillMaterial = material(scene, "distant-hills", "#36594a");
  const rockMaterial = material(scene, "rocks", "#6e756d");
  const trunkMaterial = material(scene, "tree-trunks", "#493b2b");
  const foliageDark = material(scene, "foliage-dark", "#24533b");
  const foliageLight = material(scene, "foliage-light", "#467649");
  const hills: Mesh[] = [];
  const rocks: Mesh[] = [];
  const trunks: Mesh[] = [];
  const darkCrowns: Mesh[] = [];
  const lightCrowns: Mesh[] = [];

  for (let index = 0; index < 22; index += 1) {
    const angle = (index / 22) * Math.PI * 2;
    const radius = 98 + (index % 4) * 11;
    const hill = MeshBuilder.CreateSphere(
      "distant-hill",
      { diameter: 34 + (index % 5) * 6, segments: 10 },
      scene
    );
    hill.position.set(
      Math.cos(angle) * radius,
      -9 + (index % 3),
      Math.sin(angle) * radius
    );
    hill.scaling.y = 0.62 + (index % 4) * 0.08;
    hills.push(hill);
  }

  for (let index = 0; index < 78; index += 1) {
    const sampleIndex = (index * 23 + 11) % track.centerline.length;
    const frame = frameAt(track, sampleIndex);
    const side = index % 2 === 0 ? -1 : 1;
    const position = safeRoadsidePosition(
      track,
      frame,
      side,
      track.width * 0.5 + 7 + (index % 5) * 2.3
    );
    if (!position) {
      continue;
    }
    const height = 4.6 + (index % 7) * 0.62;
    const trunk = MeshBuilder.CreateCylinder(
      "pine-trunk",
      {
        diameterTop: 0.22,
        diameterBottom: 0.38,
        height,
        tessellation: 7
      },
      scene
    );
    trunk.position = position.add(new Vector3(0, height * 0.5, 0));
    trunks.push(trunk);

    const crown = MeshBuilder.CreateCylinder(
      "pine-crown",
      {
        diameterTop: 0.1,
        diameterBottom: 3 + (index % 3) * 0.42,
        height: height * 0.92,
        tessellation: 9
      },
      scene
    );
    crown.position = position.add(new Vector3(0, height * 0.88, 0));
    (index % 3 === 0 ? lightCrowns : darkCrowns).push(crown);

    if (index % 4 === 0) {
      const rock = MeshBuilder.CreatePolyhedron(
        "track-rock",
        { type: index % 3, size: 1.1 + (index % 4) * 0.28 },
        scene
      );
      rock.position = position
        .add(frame.normal.scale(side * 2.4))
        .add(new Vector3(0, 0.55, 0));
      rock.rotation.set(index * 0.13, index * 0.37, index * 0.08);
      rocks.push(rock);
    }
  }

  mergeByMaterial(hills, "distant-hills-merged", hillMaterial);
  mergeByMaterial(rocks, "rocks-merged", rockMaterial);
  mergeByMaterial(trunks, "tree-trunks-merged", trunkMaterial);
  mergeByMaterial(darkCrowns, "foliage-dark-merged", foliageDark);
  mergeByMaterial(lightCrowns, "foliage-light-merged", foliageLight);
};

const createTunnel = (
  scene: Scene,
  track: TrackDefinition,
  palette: TrackPalette
): void => {
  const wallMaterial = material(scene, "tunnel-wall", "#d8d1c2");
  const ceilingMaterial = material(scene, "tunnel-ceiling", "#51595c");
  const lightMaterial = material(
    scene,
    "tunnel-lights",
    palette.highlight,
    1
  );
  lightMaterial.disableLighting = true;
  const walls: Mesh[] = [];
  const ceilings: Mesh[] = [];
  const lights: Mesh[] = [];
  const start = Math.floor(track.centerline.length * 0.64);
  const end = Math.floor(track.centerline.length * 0.77);
  const step = 4;

  for (let index = start; index < end; index += step) {
    const frame = frameAt(track, index);
    const future = frameAt(track, Math.min(end, index + step));
    const midpoint = frame.point.add(future.point).scale(0.5);
    const depth = Vector3.Distance(frame.point, future.point) * 1.08;
    const heading = Math.atan2(frame.tangent.x, frame.tangent.z);

    for (const side of [-1, 1]) {
      const wall = MeshBuilder.CreateBox(
        "tunnel-wall-segment",
        { width: 0.48, height: 4.8, depth },
        scene
      );
      wall.position = midpoint
        .add(frame.normal.scale(side * (track.width * 0.5 + 0.58)))
        .add(new Vector3(0, 2.4, 0));
      wall.rotation.y = heading;
      walls.push(wall);
    }

    const ceiling = MeshBuilder.CreateBox(
      "tunnel-ceiling-segment",
      { width: track.width + 1.7, height: 0.32, depth },
      scene
    );
    ceiling.position = midpoint.add(new Vector3(0, 4.72, 0));
    ceiling.rotation.y = heading;
    ceilings.push(ceiling);

    const light = MeshBuilder.CreateBox(
      "tunnel-light",
      { width: 0.13, height: 0.05, depth: Math.max(1.1, depth * 0.5) },
      scene
    );
    light.position = midpoint.add(new Vector3(0, 4.5, 0));
    light.rotation.y = heading;
    lights.push(light);
  }

  mergeByMaterial(walls, "tunnel-walls-merged", wallMaterial);
  mergeByMaterial(ceilings, "tunnel-ceiling-merged", ceilingMaterial);
  mergeByMaterial(lights, "tunnel-lights-merged", lightMaterial, false);
};

const createRivieraScenery = (
  scene: Scene,
  track: TrackDefinition,
  palette: TrackPalette
): void => {
  const buildingColors = [
    "#f0dfc2",
    "#e8b995",
    "#c9d6cf",
    "#d8c5d4",
    "#eee8d9"
  ] as const;
  const buildingMaterials = buildingColors.map((color, index) =>
    material(scene, `building-${index}`, color)
  );
  const roofMaterial = material(scene, "building-roofs", "#8d6757");
  const windowMaterial = material(scene, "windows", "#74a9b7", 0.12);
  const buildings: Mesh[][] = buildingMaterials.map(() => []);
  const roofs: Mesh[] = [];
  const windows: Mesh[] = [];
  let buildingIndex = 0;

  for (let x = -91; x <= 91; x += 14) {
    for (let z = -48; z <= 82; z += 14) {
      const seed = Math.abs(x * 31 + z * 17);
      if (seed % 7 === 0 || (z < -38 && x > -34)) {
        continue;
      }
      const projection = projectToTrack(x, z, track.id);
      if (
        projection.distance < track.width * 0.5 + 9 ||
        projection.distance > 38
      ) {
        continue;
      }

      const width = 7.4 + (seed % 4) * 0.8;
      const depth = 7 + ((seed + 2) % 4) * 0.75;
      const height = 8 + (seed % 8) * 2.25;
      const building = MeshBuilder.CreateBox(
        "riviera-building",
        { width, height, depth },
        scene
      );
      building.position.set(
        x + ((seed % 3) - 1) * 1.2,
        height * 0.5,
        z + (((seed >> 2) % 3) - 1) * 1.1
      );
      building.rotation.y = (seed % 5) * 0.025;
      buildings[buildingIndex % buildingMaterials.length]?.push(building);

      const roof = MeshBuilder.CreateBox(
        "riviera-roof",
        { width: width + 0.35, height: 0.42, depth: depth + 0.35 },
        scene
      );
      roof.position = building.position.add(
        new Vector3(0, height * 0.5 + 0.21, 0)
      );
      roof.rotation.y = building.rotation.y;
      roofs.push(roof);

      const bandCount = Math.max(2, Math.floor(height / 4.2));
      for (let band = 1; band <= bandCount; band += 1) {
        const windowBand = MeshBuilder.CreateBox(
          "window-band",
          {
            width: width + 0.06,
            height: 0.24,
            depth: depth + 0.06
          },
          scene
        );
        windowBand.position = building.position.add(
          new Vector3(0, -height * 0.5 + band * 3.2, 0)
        );
        windowBand.rotation.y = building.rotation.y;
        windows.push(windowBand);
      }
      buildingIndex += 1;
    }
  }

  buildingMaterials.forEach((buildingMaterial, index) => {
    mergeByMaterial(
      buildings[index] ?? [],
      `riviera-buildings-${index}`,
      buildingMaterial
    );
  });
  mergeByMaterial(roofs, "riviera-roofs-merged", roofMaterial);
  mergeByMaterial(windows, "riviera-windows-merged", windowMaterial);

  const waterMaterial = material(
    scene,
    "harbor-water",
    palette.water,
    0.08
  );
  waterMaterial.alpha = 0.94;
  waterMaterial.specularColor = Color3.FromHexString("#d7f2ef");
  waterMaterial.specularPower = 96;
  const water = MeshBuilder.CreateGround(
    "harbor-water",
    { width: 126, height: 34, subdivisions: 1 },
    scene
  );
  water.material = waterMaterial;
  water.position.set(16, -0.02, -83);
  water.isPickable = false;

  const quayMaterial = material(scene, "harbor-quay", "#d5c7ab");
  const quay = MeshBuilder.CreateBox(
    "harbor-quay",
    { width: 128, height: 0.48, depth: 1.8 },
    scene
  );
  quay.material = quayMaterial;
  quay.position.set(15, 0.16, -65.2);

  const yachtMaterial = material(scene, "yachts", "#f7f6ee");
  const yachtAccent = material(scene, "yacht-windows", "#28536a", 0.08);
  const hulls: Mesh[] = [];
  const cabins: Mesh[] = [];
  for (let index = 0; index < 10; index += 1) {
    const hull = MeshBuilder.CreateCapsule(
      "yacht-hull",
      {
        radius: 0.75 + (index % 3) * 0.08,
        height: 5.4 + (index % 2) * 1.2,
        tessellation: 12,
        subdivisions: 2
      },
      scene
    );
    hull.position.set(-20 + index * 8, 0.45, -76 - (index % 2) * 8);
    hull.rotation.x = Math.PI / 2;
    hull.rotation.y = index % 2 === 0 ? 0.06 : -0.06;
    hulls.push(hull);

    const cabin = MeshBuilder.CreateBox(
      "yacht-cabin",
      { width: 1.3, height: 0.68, depth: 1.9 },
      scene
    );
    cabin.position = hull.position.add(new Vector3(0, 0.65, -0.25));
    cabin.rotation.y = hull.rotation.y;
    cabins.push(cabin);
  }
  mergeByMaterial(hulls, "yacht-hulls-merged", yachtMaterial);
  mergeByMaterial(cabins, "yacht-cabins-merged", yachtAccent);

  const palmTrunk = material(scene, "palm-trunks", "#705239");
  const palmLeaf = material(scene, "palm-leaves", "#31805d");
  const trunks: Mesh[] = [];
  const leaves: Mesh[] = [];
  for (let index = 0; index < 26; index += 1) {
    const sampleIndex = (index * 31 + 18) % track.centerline.length;
    const frame = frameAt(track, sampleIndex);
    const side = index % 2 === 0 ? 1 : -1;
    const position = safeRoadsidePosition(
      track,
      frame,
      side,
      track.width * 0.5 + 5.8
    );
    if (!position) {
      continue;
    }
    const height = 5 + (index % 3) * 0.55;
    const trunk = MeshBuilder.CreateCylinder(
      "palm-trunk",
      {
        diameterTop: 0.18,
        diameterBottom: 0.38,
        height,
        tessellation: 8
      },
      scene
    );
    trunk.position = position.add(new Vector3(0, height * 0.5, 0));
    trunks.push(trunk);

    for (let leafIndex = 0; leafIndex < 6; leafIndex += 1) {
      const leaf = MeshBuilder.CreateBox(
        "palm-leaf",
        { width: 0.18, height: 0.07, depth: 2.5 },
        scene
      );
      leaf.position = position.add(new Vector3(0, height, 0));
      leaf.rotation.y = (leafIndex / 6) * Math.PI * 2;
      leaf.rotation.x = 0.25;
      leaves.push(leaf);
    }
  }
  mergeByMaterial(trunks, "palm-trunks-merged", palmTrunk);
  mergeByMaterial(leaves, "palm-leaves-merged", palmLeaf);

  const lampMaterial = material(scene, "street-lamps", "#3f4b50");
  const lampGlow = material(scene, "street-lamp-glow", "#fff0b0", 1);
  lampGlow.disableLighting = true;
  const lampPosts: Mesh[] = [];
  const lampHeads: Mesh[] = [];
  for (let index = 12; index < track.centerline.length; index += 34) {
    const frame = frameAt(track, index);
    const side = index % 68 === 0 ? -1 : 1;
    const position = safeRoadsidePosition(
      track,
      frame,
      side,
      track.width * 0.5 + 3.3
    );
    if (!position) {
      continue;
    }
    const post = MeshBuilder.CreateCylinder(
      "street-lamp-post",
      { diameter: 0.18, height: 5.4, tessellation: 8 },
      scene
    );
    post.position = position.add(new Vector3(0, 2.7, 0));
    lampPosts.push(post);

    const head = MeshBuilder.CreateBox(
      "street-lamp-head",
      { width: 1.1, height: 0.16, depth: 0.38 },
      scene
    );
    head.position = position.add(new Vector3(0, 5.35, 0));
    head.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z);
    lampHeads.push(head);
  }
  mergeByMaterial(lampPosts, "street-lamp-posts-merged", lampMaterial);
  mergeByMaterial(lampHeads, "street-lamp-heads-merged", lampGlow, false);

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

  createSky(scene, palette);

  const groundTexture = patternTexture(
    scene,
    "ground-pattern",
    palette.ground,
    palette.groundDetail
  );
  const groundMaterial = material(scene, "ground-material", palette.ground);
  groundMaterial.diffuseTexture = groundTexture;
  groundMaterial.specularColor = Color3.Black();
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: 300, height: 300, subdivisions: 1 },
    scene
  );
  ground.material = groundMaterial;
  ground.position.y = -0.12;
  ground.receiveShadows = true;
  ground.isPickable = false;

  const shoulderMaterial = material(
    scene,
    "shoulder-material",
    palette.shoulder
  );
  shoulderMaterial.specularColor = Color3.Black();
  const asphaltTexture = patternTexture(
    scene,
    "asphalt-pattern",
    palette.road,
    palette.roadDetail,
    true
  );
  const roadMaterial = material(scene, "asphalt-material", palette.road);
  roadMaterial.diffuseTexture = asphaltTexture;
  roadMaterial.specularColor = new Color3(0.17, 0.18, 0.18);
  roadMaterial.specularPower = 72;

  ribbon(
    scene,
    track,
    "track-shoulder",
    track.width * 0.5 + 1.15,
    0.015,
    shoulderMaterial
  );
  ribbon(
    scene,
    track,
    "track-road",
    track.width * 0.5,
    0.075,
    roadMaterial
  );

  createRetainingWalls(scene, track, palette);
  createRoadMarkings(scene, track);
  createCurbs(scene, track, palette);
  createBarriers(scene, track, palette);
  createStartGrid(scene, track);
  createStartArch(scene, track, palette);

  if (track.id === "riviera-royale") {
    createRivieraScenery(scene, track, palette);
  } else {
    createAuroraScenery(scene, track);
  }

  scene.metadata = {
    ...scene.metadata,
    trackId: track.id,
    trackName: track.name,
    skyColor: palette.skyTop,
    fogColor: palette.fog
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
    meshes: createdMeshes,
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
