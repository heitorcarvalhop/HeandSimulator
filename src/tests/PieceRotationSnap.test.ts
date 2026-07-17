import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CUBE_ROTATIONS, rotateGridOffset, snapToNearestCubeRotation } from '../interaction/PieceRotationSnap';

describe('PieceRotationSnap', () => {
  it('generates exactly the 24 proper rotations of a cube', () => {
    expect(CUBE_ROTATIONS.length).toBe(24);
  });

  it('maps every basis axis to an axis-aligned unit vector for each of the 24 rotations', () => {
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    for (const rotation of CUBE_ROTATIONS) {
      for (const axis of axes) {
        const rotated = axis.clone().applyQuaternion(rotation);
        const rounded = new THREE.Vector3(Math.round(rotated.x), Math.round(rotated.y), Math.round(rotated.z));
        expect(rotated.distanceTo(rounded)).toBeLessThan(1e-5);
        expect(rounded.length()).toBeCloseTo(1, 5);
      }
    }
  });

  it('snaps the identity quaternion to a rotation equivalent to identity', () => {
    const snapped = snapToNearestCubeRotation(new THREE.Quaternion());
    const point = new THREE.Vector3(1, 2, 3).applyQuaternion(snapped);
    expect(point.x).toBeCloseTo(1, 5);
    expect(point.y).toBeCloseTo(2, 5);
    expect(point.z).toBeCloseTo(3, 5);
  });

  it('snaps a quaternion close to a known 90°-around-Z rotation back to that exact rotation', () => {
    const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    // Perturba um pouco (como a orientação real da mão nunca é exatamente 90°).
    const nudged = target.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.05));

    const snapped = snapToNearestCubeRotation(nudged);
    expect(Math.abs(snapped.dot(target))).toBeCloseTo(1, 4);
  });

  it('snaps every one of the 24 rotations to itself (round-trip)', () => {
    for (const rotation of CUBE_ROTATIONS) {
      const snapped = snapToNearestCubeRotation(rotation.clone());
      expect(Math.abs(snapped.dot(rotation))).toBeCloseTo(1, 5);
    }
  });

  it('rotates an integer grid offset by a 90°-around-Y rotation to an exact integer result', () => {
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const result = rotateGridOffset({ x: 1, y: 0, z: 0 }, rotation);
    expect(result).toEqual({ x: 0, y: 0, z: -1 });
  });

  it('leaves an offset unchanged under the identity rotation', () => {
    const result = rotateGridOffset({ x: 2, y: -1, z: 3 }, new THREE.Quaternion());
    expect(result).toEqual({ x: 2, y: -1, z: 3 });
  });
});
