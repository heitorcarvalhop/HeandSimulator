import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VoxelGrid } from '../voxels/VoxelGrid';
import { TransformController } from '../interaction/TransformController';

describe('TransformController voxel drag', () => {
  it('proposes the cursor-snapped cell for a single-voxel drag', () => {
    const grid = new VoxelGrid();
    const voxel = grid.add({ x: 0, y: 0, z: 0 })!;
    const controller = new TransformController();

    const state = controller.beginVoxelDrag([voxel], new THREE.Vector3(0, 0, 0));
    controller.updateVoxelDrag(state, new THREE.Vector3(1.2, 0, 0), 0.6, grid, true);

    expect(state.targets[0].proposedCoord).toEqual({ x: 2, y: 0, z: 0 });
    expect(state.valid).toBe(true);
  });

  it('marks the drag invalid when the target cell is occupied by another voxel', () => {
    const grid = new VoxelGrid();
    const moving = grid.add({ x: 0, y: 0, z: 0 })!;
    grid.add({ x: 2, y: 0, z: 0 });
    const controller = new TransformController();

    const state = controller.beginVoxelDrag([moving], new THREE.Vector3(0, 0, 0));
    controller.updateVoxelDrag(state, new THREE.Vector3(1.2, 0, 0), 0.6, grid, true);

    expect(state.valid).toBe(false);
  });

  it('allows a voxel to hover back over its own original cell (excluded from collision)', () => {
    const grid = new VoxelGrid();
    const voxel = grid.add({ x: 0, y: 0, z: 0 })!;
    const controller = new TransformController();

    const state = controller.beginVoxelDrag([voxel], new THREE.Vector3(0, 0, 0));
    controller.updateVoxelDrag(state, new THREE.Vector3(0.05, 0, 0), 0.6, grid, true);

    expect(state.valid).toBe(true);
    expect(state.targets[0].proposedCoord).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('moves a whole group by a consistent grid delta based on cursor movement', () => {
    const grid = new VoxelGrid();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    const b = grid.add({ x: 1, y: 0, z: 0 })!;
    const controller = new TransformController();

    const state = controller.beginVoxelDrag([a, b], new THREE.Vector3(0, 0, 0));
    controller.updateVoxelDrag(state, new THREE.Vector3(0, 1.2, 0), 0.6, grid, true);

    const proposedA = state.targets.find((t) => t.voxelId === a.id)!.proposedCoord;
    const proposedB = state.targets.find((t) => t.voxelId === b.id)!.proposedCoord;
    expect(proposedA).toEqual({ x: 0, y: 2, z: 0 });
    expect(proposedB).toEqual({ x: 1, y: 2, z: 0 });
    expect(state.valid).toBe(true);
  });

  it('rejects a group move that would collide with a voxel outside the group', () => {
    const grid = new VoxelGrid();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    const b = grid.add({ x: 1, y: 0, z: 0 })!;
    grid.add({ x: 0, y: 2, z: 0 }); // blocks the target cell for `a`
    const controller = new TransformController();

    const state = controller.beginVoxelDrag([a, b], new THREE.Vector3(0, 0, 0));
    controller.updateVoxelDrag(state, new THREE.Vector3(0, 1.2, 0), 0.6, grid, true);

    expect(state.valid).toBe(false);
  });

  it('rejects a move that would leave a voxel floating when floating is disallowed', () => {
    const grid = new VoxelGrid();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    grid.add({ x: 1, y: 0, z: 0 }); // neighbor that stays put
    const controller = new TransformController();

    const state = controller.beginVoxelDrag([a], new THREE.Vector3(0, 0, 0));
    // Move para longe de tudo, com flutuação desabilitada.
    controller.updateVoxelDrag(state, new THREE.Vector3(6, 6, 6), 0.6, grid, false);

    expect(state.valid).toBe(false);
  });
});

describe('TransformController two-hand scale + rotate', () => {
  it('scales proportionally to the change in distance between the two hands', () => {
    const transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 };
    const controller = new TransformController();
    const handA = new THREE.Vector3(-1, 0, 0);
    const handB = new THREE.Vector3(1, 0, 0);

    const state = controller.beginTwoHandDrag(handA, handB, transform);
    const widerA = new THREE.Vector3(-2, 0, 0);
    const widerB = new THREE.Vector3(2, 0, 0);
    controller.updateTwoHandDrag(state, widerA, widerB, transform);

    expect(transform.scale).toBeCloseTo(2, 5);
  });

  it('clamps scale to the configured min/max range', () => {
    const transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 };
    const controller = new TransformController();
    const handA = new THREE.Vector3(-1, 0, 0);
    const handB = new THREE.Vector3(1, 0, 0);

    const state = controller.beginTwoHandDrag(handA, handB, transform);
    controller.updateTwoHandDrag(state, new THREE.Vector3(-20, 0, 0), new THREE.Vector3(20, 0, 0), transform);

    expect(transform.scale).toBeLessThanOrEqual(3.0);
  });
});
