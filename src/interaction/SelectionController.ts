import * as THREE from 'three';
import type { Voxel } from '../voxels/Voxel';
import type { VoxelGrid } from '../voxels/VoxelGrid';
import type { VoxelRenderer } from '../voxels/VoxelRenderer';
import { findSegmentPath } from '../voxels/ConnectedComponents';

/** Hover/seleção via raycasting e o fluxo de "seleção de segmento" (dois cliques). */
export class SelectionController {
  hoveredVoxelId: string | null = null;
  segmentModeEnabled = false;
  private segmentAnchorId: string | null = null;

  constructor(
    private readonly grid: VoxelGrid,
    private readonly renderer: VoxelRenderer,
  ) {}

  raycastVoxel(raycaster: THREE.Raycaster, modelGroup: THREE.Group): Voxel | null {
    const mesh = this.renderer.getSolidMesh();
    const localRay = raycaster.ray.clone().applyMatrix4(modelGroup.matrixWorld.clone().invert());
    const inverseRaycaster = new THREE.Raycaster(localRay.origin, localRay.direction);
    const hits = inverseRaycaster.intersectObject(mesh, false);
    if (hits.length === 0 || hits[0].instanceId === undefined) return null;
    const id = this.renderer.getVoxelIdAtInstance(hits[0].instanceId);
    return id ? (this.grid.get(id) ?? null) : null;
  }

  setHover(voxelId: string | null): void {
    this.hoveredVoxelId = voxelId;
  }

  selectSingle(voxelId: string): void {
    this.grid.clearSelection();
    this.grid.setSelected(voxelId, true);
  }

  selectMany(voxelIds: string[]): void {
    this.grid.clearSelection();
    for (const id of voxelIds) this.grid.setSelected(id, true);
  }

  clearSelection(): void {
    this.grid.clearSelection();
    this.segmentAnchorId = null;
  }

  /** Primeira chamada define a âncora inicial; a segunda resolve o caminho e seleciona a cadeia toda. */
  pickSegmentAnchor(voxelId: string): boolean {
    if (!this.segmentAnchorId) {
      this.segmentAnchorId = voxelId;
      this.grid.clearSelection();
      this.grid.setSelected(voxelId, true);
      return false;
    }

    if (this.segmentAnchorId === voxelId) return false;

    const path = findSegmentPath(this.grid, this.segmentAnchorId, voxelId);
    this.segmentAnchorId = null;
    if (path.length === 0) return false;

    this.grid.clearSelection();
    for (const voxel of path) this.grid.setSelected(voxel.id, true);
    return true;
  }

  cancelSegmentAnchor(): void {
    this.segmentAnchorId = null;
  }

  get hasPendingSegmentAnchor(): boolean {
    return this.segmentAnchorId !== null;
  }
}
