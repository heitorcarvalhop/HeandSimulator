import * as THREE from 'three';
import type { GridCoord } from '../voxels/Voxel';

/**
 * Converte um ponto de mundo (ex.: a ponta da pinça) para o espaço local do `modelGroup`.
 * Necessário porque a grade de voxels é armazenada em coordenadas locais ao grupo do modelo,
 * então qualquer ponto de mundo precisa passar pela inversa do transform atual (posição/rotação/
 * escala) antes de virar célula de grade — do contrário, mover/girar/escalar o modelo desalinha
 * onde a pinça aponta do que a grade calcula.
 */
export function worldToLocalPoint(modelGroup: THREE.Object3D, worldPos: THREE.Vector3): THREE.Vector3 {
  return modelGroup.worldToLocal(worldPos.clone());
}

export function worldToLocalGrid(modelGroup: THREE.Object3D, worldPos: THREE.Vector3, voxelSize: number): GridCoord {
  const local = worldToLocalPoint(modelGroup, worldPos);
  return {
    x: Math.round(local.x / voxelSize),
    y: Math.round(local.y / voxelSize),
    z: Math.round(local.z / voxelSize),
  };
}
