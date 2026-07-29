import "@babylonjs/loaders/glTF/index.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Node } from "@babylonjs/core/node";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

export const KART_ASSET_PATHS = [
  "/assets/kenney/karts/kart-oobi.glb",
  "/assets/kenney/karts/kart-oodi.glb",
  "/assets/kenney/karts/kart-ooli.glb",
  "/assets/kenney/karts/kart-oopi.glb",
  "/assets/kenney/karts/kart-oozi.glb"
] as const;

export const RIVIERA_ASSETS = {
  barrierRed: "/assets/kenney/racing/barrierRed.glb",
  barrierWall: "/assets/kenney/racing/barrierWall.glb",
  barrierWhite: "/assets/kenney/racing/barrierWhite.glb",
  billboard: "/assets/kenney/racing/billboardLow.glb",
  flag: "/assets/kenney/racing/flagCheckers.glb",
  grandstand: "/assets/kenney/racing/grandStandCovered.glb",
  lamp: "/assets/kenney/racing/lightPostModern.glb",
  startLights: "/assets/kenney/racing/overheadLights.glb",
  pits: "/assets/kenney/racing/pitsGarage.glb",
  tent: "/assets/kenney/racing/tentLong.glb",
  buildingA: "/assets/kenney/city/building-a.glb",
  buildingB: "/assets/kenney/city/building-b.glb",
  buildingC: "/assets/kenney/city/building-c.glb",
  buildingD: "/assets/kenney/city/building-d.glb",
  buildingE: "/assets/kenney/city/building-e.glb",
  buildingH: "/assets/kenney/city/building-h.glb",
  buildingJ: "/assets/kenney/city/building-j.glb",
  distantBuildingA:
    "/assets/kenney/city/low-detail-building-a.glb",
  distantBuildingB:
    "/assets/kenney/city/low-detail-building-b.glb",
  distantBuildingC:
    "/assets/kenney/city/low-detail-building-c.glb",
  distantBuildingG:
    "/assets/kenney/city/low-detail-building-g.glb",
  distantBuildingH:
    "/assets/kenney/city/low-detail-building-h.glb",
  parasolA: "/assets/kenney/city/detail-parasol-a.glb",
  parasolB: "/assets/kenney/city/detail-parasol-b.glb",
  sailboatA: "/assets/kenney/watercraft/boat-sail-a.glb",
  sailboatB: "/assets/kenney/watercraft/boat-sail-b.glb",
  speedboatA: "/assets/kenney/watercraft/boat-speed-a.glb",
  speedboatD: "/assets/kenney/watercraft/boat-speed-d.glb",
  speedboatF: "/assets/kenney/watercraft/boat-speed-f.glb"
} as const;

export const RIVIERA_ASSET_PATHS = Object.values(RIVIERA_ASSETS);

export interface AssetInstance {
  readonly root: TransformNode;
  readonly meshes: readonly AbstractMesh[];
  readonly nodes: readonly Node[];
  dispose(): void;
}

export class GameAssetLibrary {
  private readonly containers = new Map<
    string,
    Promise<AssetContainer>
  >();
  private instanceSequence = 0;
  private disposed = false;

  constructor(private readonly scene: Scene) {}

  preload(paths: readonly string[]): Promise<void> {
    return Promise.all(
      paths.map(async (path) => {
        await this.load(path);
      })
    ).then(() => undefined);
  }

  async instantiate(
    path: string,
    label = "asset"
  ): Promise<AssetInstance> {
    if (this.disposed) {
      throw new Error("La bibliothèque d'assets a été détruite.");
    }

    const container = await this.load(path);
    if (this.disposed) {
      throw new Error("La bibliothèque d'assets a été détruite.");
    }

    const instanceId = ++this.instanceSequence;
    const prefix = `${label}-${instanceId}`;
    const entries = container.instantiateModelsToScene(
      (sourceName) => `${prefix}-${sourceName}`,
      false
    );
    const root = new TransformNode(`${prefix}-root`, this.scene);
    const content = new TransformNode(
      `${prefix}-normalized-content`,
      this.scene
    );
    content.parent = root;

    for (const node of entries.rootNodes) {
      if (node instanceof AbstractMesh && node.getTotalVertices() === 0) {
        const transform = new TransformNode(
          `${prefix}-${node.name}-transform`,
          this.scene
        );
        transform.parent = content;
        transform.position.copyFrom(node.position);
        transform.rotation.copyFrom(node.rotation);
        transform.scaling.copyFrom(node.scaling);
        if (node.rotationQuaternion) {
          transform.rotationQuaternion = node.rotationQuaternion.clone();
        }
        for (const child of node.getChildren()) {
          child.parent = transform;
        }
        node.dispose(true, false);
      } else {
        node.parent = content;
      }
    }

    const meshes = root
      .getChildMeshes(false)
      .filter((mesh) => mesh.getTotalVertices() > 0);
    let minimum = new Vector3(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
    let maximum = new Vector3(
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY
    );
    for (const mesh of meshes) {
      mesh.isPickable = false;
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      minimum = Vector3.Minimize(minimum, bounds.minimumWorld);
      maximum = Vector3.Maximize(maximum, bounds.maximumWorld);
    }
    if (meshes.length > 0) {
      content.position.set(
        -(minimum.x + maximum.x) * 0.5,
        -minimum.y,
        -(minimum.z + maximum.z) * 0.5
      );
    }

    let instanceDisposed = false;
    return {
      root,
      meshes,
      nodes: [root, ...root.getDescendants(false)],
      dispose(): void {
        if (instanceDisposed) {
          return;
        }
        instanceDisposed = true;
        entries.dispose();
        root.dispose(false);
      }
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const containerPromise of this.containers.values()) {
      void containerPromise.then((container) => {
        container.dispose();
      });
    }
    this.containers.clear();
  }

  private load(path: string): Promise<AssetContainer> {
    const existing = this.containers.get(path);
    if (existing) {
      return existing;
    }

    const loading = LoadAssetContainerAsync(path, this.scene).catch(
      (error: unknown) => {
        this.containers.delete(path);
        throw error;
      }
    );
    this.containers.set(path, loading);
    return loading;
  }
}
