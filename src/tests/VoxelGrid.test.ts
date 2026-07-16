import { describe, expect, it } from 'vitest';
import { VoxelGrid } from '../voxels/VoxelGrid';

describe('VoxelGrid', () => {
  it('adds a voxel and retrieves it by coordinate and id', () => {
    const grid = new VoxelGrid();
    const voxel = grid.add({ x: 1, y: 2, z: 3 });
    expect(voxel).not.toBeNull();
    expect(grid.getAt({ x: 1, y: 2, z: 3 })?.id).toBe(voxel!.id);
    expect(grid.get(voxel!.id)?.gridX).toBe(1);
    expect(grid.size).toBe(1);
  });

  it('refuses to add a voxel on an already-occupied cell (collision)', () => {
    const grid = new VoxelGrid();
    grid.add({ x: 0, y: 0, z: 0 });
    const second = grid.add({ x: 0, y: 0, z: 0 });
    expect(second).toBeNull();
    expect(grid.size).toBe(1);
  });

  it('removes a voxel by id and frees its cell', () => {
    const grid = new VoxelGrid();
    const voxel = grid.add({ x: 0, y: 0, z: 0 })!;
    const removed = grid.remove(voxel.id);
    expect(removed?.id).toBe(voxel.id);
    expect(grid.has({ x: 0, y: 0, z: 0 })).toBe(false);
    expect(grid.size).toBe(0);
  });

  it('moves a voxel to a free cell', () => {
    const grid = new VoxelGrid();
    const voxel = grid.add({ x: 0, y: 0, z: 0 })!;
    const moved = grid.move(voxel.id, { x: 5, y: 5, z: 5 });
    expect(moved).toBe(true);
    expect(grid.has({ x: 0, y: 0, z: 0 })).toBe(false);
    expect(grid.getAt({ x: 5, y: 5, z: 5 })?.id).toBe(voxel.id);
  });

  it('refuses to move a voxel onto another occupied cell', () => {
    const grid = new VoxelGrid();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    grid.add({ x: 1, y: 0, z: 0 });
    const moved = grid.move(a.id, { x: 1, y: 0, z: 0 });
    expect(moved).toBe(false);
    expect(grid.getAt({ x: 0, y: 0, z: 0 })?.id).toBe(a.id);
  });

  it('finds face-adjacent neighbors only', () => {
    const grid = new VoxelGrid();
    grid.add({ x: 0, y: 0, z: 0 });
    grid.add({ x: 1, y: 0, z: 0 });
    grid.add({ x: 0, y: 1, z: 0 });
    grid.add({ x: 1, y: 1, z: 0 }); // diagonal, not a face neighbor of (0,0,0)

    const neighbors = grid.neighbors({ x: 0, y: 0, z: 0 });
    expect(neighbors).toHaveLength(2);
  });

  it('hasSupport is true only when at least one face neighbor exists', () => {
    const grid = new VoxelGrid();
    grid.add({ x: 0, y: 0, z: 0 });
    expect(grid.hasSupport({ x: 0, y: 0, z: 0 })).toBe(false);
    grid.add({ x: 1, y: 0, z: 0 });
    expect(grid.hasSupport({ x: 0, y: 0, z: 0 })).toBe(true);
  });

  it('selection helpers track selected voxels', () => {
    const grid = new VoxelGrid();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    grid.add({ x: 1, y: 0, z: 0 });
    grid.setSelected(a.id, true);
    expect(grid.selected()).toHaveLength(1);
    grid.clearSelection();
    expect(grid.selected()).toHaveLength(0);
  });

  it('clear empties the grid', () => {
    const grid = new VoxelGrid();
    grid.add({ x: 0, y: 0, z: 0 });
    grid.add({ x: 1, y: 0, z: 0 });
    grid.clear();
    expect(grid.size).toBe(0);
  });

  it('bumps version on structural mutation', () => {
    const grid = new VoxelGrid();
    const before = grid.version;
    grid.add({ x: 0, y: 0, z: 0 });
    expect(grid.version).toBeGreaterThan(before);
  });
});
