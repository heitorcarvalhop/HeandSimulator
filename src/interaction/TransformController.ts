import * as THREE from 'three';
import { angleDelta, clamp } from '../utils/MathUtils';
import type { GridCoord, Voxel } from '../voxels/Voxel';
import type { VoxelGrid } from '../voxels/VoxelGrid';
import type { ModelTransform } from '../voxels/VoxelSerializer';

export const MIN_SCALE = 0.4;
export const MAX_SCALE = 3.0;

export interface VoxelDragTarget {
  voxelId: string;
  originalCoord: GridCoord;
  proposedCoord: GridCoord;
}

export interface VoxelDragState {
  targets: VoxelDragTarget[];
  startCursorWorld: THREE.Vector3;
  startGridCell: GridCoord;
  valid: boolean;
}

export interface ModelDragState {
  startHandWorld: THREE.Vector3;
  startPosition: { x: number; y: number; z: number };
}

export interface TwoHandDragState {
  startDistance: number;
  startScale: number;
  startRotationZ: number;
  lastAngle: number;
  anchorWorld: THREE.Vector3;
  anchorPosition: { x: number; y: number; z: number };
}

/** Matemática de arraste de voxel/grupo/modelo. Arrastes que mudam a grade são só prévia até confirmar. */
export class TransformController {
  beginVoxelDrag(movingVoxels: Voxel[], startCursorWorld: THREE.Vector3): VoxelDragState {
    const targets: VoxelDragTarget[] = movingVoxels.map((v) => ({
      voxelId: v.id,
      originalCoord: { x: v.gridX, y: v.gridY, z: v.gridZ },
      proposedCoord: { x: v.gridX, y: v.gridY, z: v.gridZ },
    }));

    return {
      targets,
      startCursorWorld: startCursorWorld.clone(),
      startGridCell: { ...targets[0].originalCoord },
      valid: true,
    };
  }

  updateVoxelDrag(
    state: VoxelDragState,
    currentCursorWorld: THREE.Vector3,
    voxelSize: number,
    grid: VoxelGrid,
    allowFloating: boolean,
  ): VoxelDragState {
    const movingIds = new Set(state.targets.map((t) => t.voxelId));

    if (state.targets.length === 1) {
      const target: GridCoord = {
        x: Math.round(currentCursorWorld.x / voxelSize),
        y: Math.round(currentCursorWorld.y / voxelSize),
        z: Math.round(currentCursorWorld.z / voxelSize),
      };
      state.targets[0].proposedCoord = target;
    } else {
      const deltaWorld = currentCursorWorld.clone().sub(state.startCursorWorld);
      const deltaGrid: GridCoord = {
        x: Math.round(deltaWorld.x / voxelSize),
        y: Math.round(deltaWorld.y / voxelSize),
        z: Math.round(deltaWorld.z / voxelSize),
      };
      for (const target of state.targets) {
        target.proposedCoord = {
          x: target.originalCoord.x + deltaGrid.x,
          y: target.originalCoord.y + deltaGrid.y,
          z: target.originalCoord.z + deltaGrid.z,
        };
      }
    }

    state.valid = this.validateDrag(state, grid, movingIds, allowFloating);
    return state;
  }

  private validateDrag(
    state: VoxelDragState,
    grid: VoxelGrid,
    movingIds: Set<string>,
    allowFloating: boolean,
  ): boolean {
    const occupied = new Set<string>();
    for (const target of state.targets) {
      const key = `${target.proposedCoord.x}:${target.proposedCoord.y}:${target.proposedCoord.z}`;
      if (occupied.has(key)) return false;
      occupied.add(key);

      const existing = grid.getAt(target.proposedCoord);
      if (existing && !movingIds.has(existing.id)) return false;
    }

    if (!allowFloating) {
      for (const target of state.targets) {
        const hasSupportWithinBatch = state.targets.some(
          (other) =>
            other !== target &&
            Math.abs(other.proposedCoord.x - target.proposedCoord.x) +
              Math.abs(other.proposedCoord.y - target.proposedCoord.y) +
              Math.abs(other.proposedCoord.z - target.proposedCoord.z) ===
              1,
        );
        const hasSupportOutsideBatch = grid
          .neighbors(target.proposedCoord)
          .some((n) => !movingIds.has(n.id));
        if (!hasSupportWithinBatch && !hasSupportOutsideBatch) return false;
      }
    }

    return true;
  }

  beginModelDrag(handWorld: THREE.Vector3, transform: ModelTransform): ModelDragState {
    return {
      startHandWorld: handWorld.clone(),
      startPosition: { ...transform.position },
    };
  }

  updateModelDrag(state: ModelDragState, handWorld: THREE.Vector3, transform: ModelTransform): void {
    const delta = handWorld.clone().sub(state.startHandWorld);
    transform.position.x = state.startPosition.x + delta.x;
    transform.position.y = state.startPosition.y + delta.y;
    transform.position.z = state.startPosition.z + delta.z;
  }

  beginTwoHandDrag(handA: THREE.Vector3, handB: THREE.Vector3, transform: ModelTransform): TwoHandDragState {
    const distance = handA.distanceTo(handB);
    const angle = Math.atan2(handB.y - handA.y, handB.x - handA.x);
    const midpoint = handA.clone().add(handB).multiplyScalar(0.5);
    return {
      startDistance: Math.max(distance, 1e-4),
      startScale: transform.scale,
      startRotationZ: transform.rotation.z,
      lastAngle: angle,
      anchorWorld: midpoint,
      anchorPosition: { ...transform.position },
    };
  }

  updateTwoHandDrag(state: TwoHandDragState, handA: THREE.Vector3, handB: THREE.Vector3, transform: ModelTransform): void {
    const distance = handA.distanceTo(handB);
    const scaleRatio = distance / state.startDistance;
    const newScale = clamp(state.startScale * scaleRatio, MIN_SCALE, MAX_SCALE);

    const angle = Math.atan2(handB.y - handA.y, handB.x - handA.x);
    const delta = angleDelta(state.lastAngle, angle);
    transform.rotation.z += delta;
    state.lastAngle = angle;

    transform.scale = newScale;

    const scaleFactor = newScale / state.startScale;
    transform.position.x = state.anchorWorld.x + (state.anchorPosition.x - state.anchorWorld.x) * scaleFactor;
    transform.position.y = state.anchorWorld.y + (state.anchorPosition.y - state.anchorWorld.y) * scaleFactor;
    transform.position.z = state.anchorWorld.z + (state.anchorPosition.z - state.anchorWorld.z) * scaleFactor;
  }

  /** Rotação com uma mão (modo "transformação"): arraste horizontal -> yaw, vertical -> pitch. */
  applySingleHandRotation(
    transform: ModelTransform,
    deltaScreenX: number,
    deltaScreenY: number,
    sensitivity: number,
  ): void {
    transform.rotation.y += deltaScreenX * sensitivity;
    transform.rotation.x += deltaScreenY * sensitivity;
  }
}
