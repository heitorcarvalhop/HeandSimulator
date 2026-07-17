import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VoxelRenderer } from '../voxels/VoxelRenderer';
import { VoxelGrid } from '../voxels/VoxelGrid';

describe('VoxelRenderer held piece + free transform', () => {
  it('excludes held voxel ids from the main instanced batch', () => {
    const renderer = new VoxelRenderer(1);
    const grid = new VoxelGrid();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    grid.add({ x: 1, y: 0, z: 0 });

    renderer.setHeldPiece([{ id: a.id, localOffset: { x: 0, y: 0, z: 0 }, color: '#fff' }]);
    renderer.update(grid.all(), grid.version);

    expect(renderer.getSolidMesh().count).toBe(1);
    expect(renderer.getVoxelIdAtInstance(0)).not.toBe(a.id);
  });

  it('returns the full set to the main batch once the piece is released', () => {
    const renderer = new VoxelRenderer(1);
    const grid = new VoxelGrid();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    grid.add({ x: 1, y: 0, z: 0 });

    renderer.setHeldPiece([{ id: a.id, localOffset: { x: 0, y: 0, z: 0 }, color: '#fff' }]);
    renderer.update(grid.all(), grid.version);
    renderer.setHeldPiece(null);
    renderer.update(grid.all(), grid.version);

    expect(renderer.getSolidMesh().count).toBe(2);
  });

  it('composes a committed free transform (rotation + offset) around its anchor cell', () => {
    const renderer = new VoxelRenderer(1);
    const grid = new VoxelGrid();
    const anchor = grid.add({ x: 0, y: 0, z: 0 }, { groupId: 'piece' })!;
    grid.add({ x: 1, y: 0, z: 0 }, { groupId: 'piece' });

    // Gira 90° em torno de Y (o offset +1 em X vira -1 em Z) e desloca +5 em X a partir da âncora.
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    grid.setFreeTransform('piece', {
      anchorCell: { x: 0, y: 0, z: 0 },
      offset: { x: 5, y: 0, z: 0 },
      quaternion: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    });

    renderer.update(grid.all(), grid.version, grid.freeTransforms());

    const anchorIndex = renderer.getVoxelIdAtInstance(0) === anchor.id ? 0 : 1;
    const neighborIndex = anchorIndex === 0 ? 1 : 0;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    renderer.getSolidMesh().getMatrixAt(anchorIndex, matrix);
    matrix.decompose(position, quat, scale);
    expect(position.x).toBeCloseTo(5, 5);
    expect(position.y).toBeCloseTo(0, 5);
    expect(position.z).toBeCloseTo(0, 5);

    renderer.getSolidMesh().getMatrixAt(neighborIndex, matrix);
    matrix.decompose(position, quat, scale);
    expect(position.x).toBeCloseTo(5, 5);
    expect(position.y).toBeCloseTo(0, 5);
    expect(position.z).toBeCloseTo(-1, 5);
  });
});
