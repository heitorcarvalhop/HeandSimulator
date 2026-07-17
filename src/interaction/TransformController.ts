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

export interface SwitchHandTransformState {
  startHandWorld: THREE.Vector3;
  startPosition: { x: number; y: number; z: number };
  /** Inverso da orientação da mão aberta no início do gesto, para extrair a rotação relativa a cada frame. */
  startHandQuatInverse: THREE.Quaternion;
  startModelQuaternion: THREE.Quaternion;
  startRotation: { x: number; y: number; z: number };
}

export interface PieceDragTarget {
  voxelId: string;
  /** Offset inteiro fixo em relação à célula-âncora original — não muda durante o arraste. */
  localOffset: GridCoord;
}

/**
 * Estado de "segurar uma peça pela ponta": posição e orientação livres (não presas à grade),
 * atualizadas a cada frame a partir da pinça. Só vira coordenada de grade de novo no commit
 * (snap de 90° ou transform livre), nunca durante o arraste em si — mesma filosofia de
 * "arraste é só prévia" do `VoxelDragState`.
 */
export interface PieceDragState {
  targets: PieceDragTarget[];
  anchorOriginalCell: GridCoord;
  startHandWorld: THREE.Vector3;
  startAnchorWorld: THREE.Vector3;
  /** Inverso da orientação da mão de pinça no início do gesto, para extrair a rotação relativa a cada frame. */
  startHandQuatInverse: THREE.Quaternion;
  /** Orientação da peça no início do gesto (identidade, ou a orientação livre que ela já tinha). */
  startQuaternion: THREE.Quaternion;
  liveWorldPosition: THREE.Vector3;
  liveQuaternion: THREE.Quaternion;
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

  /**
   * Checa colisão (nenhuma célula proposta duplicada ou ocupada por um voxel de fora do lote)
   * e, se `allowFloating` for falso, que cada alvo tem suporte (dentro do lote ou fora dele).
   * Reusado tanto pelo arraste normal (`updateVoxelDrag`) quanto pelo commit de peça segurada
   * (modo de encaixe 90°) — nesse segundo caso só `targets[].proposedCoord` importa.
   */
  validateDrag(
    state: Pick<VoxelDragState, 'targets'>,
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

  /**
   * Inicia o gesto "punho fechado + mão aberta": o punho é só a chave liga/desliga do comando
   * (não precisa se mexer nem influencia o resultado); a mão aberta controla a peça inteira 1:1 —
   * sua translação move a peça e sua própria orientação (giro do pulso/palma) gira a peça em 3D.
   */
  beginSwitchHandTransform(
    openHandWorld: THREE.Vector3,
    openHandQuat: THREE.Quaternion,
    transform: ModelTransform,
  ): SwitchHandTransformState {
    return {
      startHandWorld: openHandWorld.clone(),
      startPosition: { ...transform.position },
      startHandQuatInverse: openHandQuat.clone().invert(),
      startModelQuaternion: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(transform.rotation.x, transform.rotation.y, transform.rotation.z, 'XYZ'),
      ),
      startRotation: { ...transform.rotation },
    };
  }

  updateSwitchHandTransform(
    state: SwitchHandTransformState,
    openHandWorld: THREE.Vector3,
    openHandQuat: THREE.Quaternion,
    transform: ModelTransform,
  ): void {
    const delta = openHandWorld.clone().sub(state.startHandWorld);
    transform.position.x = state.startPosition.x + delta.x;
    transform.position.y = state.startPosition.y + delta.y;
    transform.position.z = state.startPosition.z + delta.z;

    // Quanto a mão girou desde o início, composto por cima da orientação inicial do modelo.
    const deltaQuat = openHandQuat.clone().multiply(state.startHandQuatInverse);
    const newQuat = deltaQuat.multiply(state.startModelQuaternion);
    const euler = new THREE.Euler().setFromQuaternion(newQuat, 'XYZ');
    transform.rotation.x = euler.x;
    transform.rotation.y = euler.y;
    transform.rotation.z = euler.z;
  }

  /**
   * Inicia "segurar uma peça pela ponta": punho fechado numa mão é a chave liga/desliga (igual
   * ao switch-hand-transform), a mão que pinçou controla a peça 1:1 — mesma matemática de
   * `beginSwitchHandTransform`, só que o resultado fica solto num `PieceDragState` (posição e
   * orientação livres, sem grade) em vez de escrever direto num `ModelTransform`.
   */
  beginPieceGrab(
    targets: PieceDragTarget[],
    anchorOriginalCell: GridCoord,
    anchorStartWorld: THREE.Vector3,
    startQuaternion: THREE.Quaternion,
    pinchHandWorld: THREE.Vector3,
    pinchHandQuat: THREE.Quaternion,
  ): PieceDragState {
    return {
      targets,
      anchorOriginalCell,
      startHandWorld: pinchHandWorld.clone(),
      startAnchorWorld: anchorStartWorld.clone(),
      startHandQuatInverse: pinchHandQuat.clone().invert(),
      startQuaternion: startQuaternion.clone(),
      liveWorldPosition: anchorStartWorld.clone(),
      liveQuaternion: startQuaternion.clone(),
    };
  }

  updatePieceGrab(state: PieceDragState, pinchHandWorld: THREE.Vector3, pinchHandQuat: THREE.Quaternion): void {
    const delta = pinchHandWorld.clone().sub(state.startHandWorld);
    state.liveWorldPosition.copy(state.startAnchorWorld).add(delta);

    const deltaQuat = pinchHandQuat.clone().multiply(state.startHandQuatInverse);
    state.liveQuaternion.copy(deltaQuat.multiply(state.startQuaternion));
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
