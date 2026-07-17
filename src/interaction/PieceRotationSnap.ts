import * as THREE from 'three';
import type { GridCoord } from '../voxels/Voxel';

const QUARTER_TURNS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
const EPSILON = 1e-4;

/** q e -q representam a mesma rotação — normaliza o sinal pelo primeiro componente não-nulo. */
function canonicalKey(quat: THREE.Quaternion): string {
  const components = [quat.x, quat.y, quat.z, quat.w].map((c) => Math.round(c / EPSILON) * EPSILON);
  const firstNonZero = components.find((c) => Math.abs(c) > EPSILON) ?? 0;
  const sign = firstNonZero < 0 ? -1 : 1;
  return components.map((c) => (sign * c).toFixed(3)).join(',');
}

function generateCubeRotations(): THREE.Quaternion[] {
  const seen = new Map<string, THREE.Quaternion>();
  const euler = new THREE.Euler();

  for (const x of QUARTER_TURNS) {
    for (const y of QUARTER_TURNS) {
      for (const z of QUARTER_TURNS) {
        euler.set(x, y, z, 'XYZ');
        const quat = new THREE.Quaternion().setFromEuler(euler);
        const key = canonicalKey(quat);
        if (!seen.has(key)) seen.set(key, quat);
      }
    }
  }

  return Array.from(seen.values());
}

/** As 24 rotações próprias do cubo (grupo octaédrico rotacional), geradas uma vez no load do módulo. */
export const CUBE_ROTATIONS: readonly THREE.Quaternion[] = generateCubeRotations();

/** Rotação mais próxima entre as 24 do cubo, pela maior similaridade (produto interno absoluto, já que q e -q são equivalentes). */
export function snapToNearestCubeRotation(quat: THREE.Quaternion): THREE.Quaternion {
  let best = CUBE_ROTATIONS[0];
  let bestDot = -Infinity;

  for (const candidate of CUBE_ROTATIONS) {
    const dot = Math.abs(candidate.dot(quat));
    if (dot > bestDot) {
      bestDot = dot;
      best = candidate;
    }
  }

  return best.clone();
}

/** Aplica uma rotação já snapada (múltiplo de 90° em cada eixo) a um offset inteiro de grade. O resultado é sempre exato. */
export function rotateGridOffset(offset: GridCoord, rotation: THREE.Quaternion): GridCoord {
  const vector = new THREE.Vector3(offset.x, offset.y, offset.z).applyQuaternion(rotation);
  return {
    x: Math.round(vector.x),
    y: Math.round(vector.y),
    z: Math.round(vector.z),
  };
}
