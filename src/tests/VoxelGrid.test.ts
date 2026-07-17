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

  it('moveMany shifts a row by one cell without a transient self-collision (A -> B\'s old spot)', () => {
    const grid = new VoxelGrid();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    const b = grid.add({ x: 1, y: 0, z: 0 })!;

    // A vai pra onde B estava; B vai pra uma célula livre — moveMany precisa liberar tudo
    // do índice antes de reinserir, senão A esbarra em B (que ainda não moveu) e falha.
    grid.moveMany([
      { id: a.id, target: { x: 1, y: 0, z: 0 } },
      { id: b.id, target: { x: 2, y: 0, z: 0 } },
    ]);

    expect(grid.getAt({ x: 1, y: 0, z: 0 })?.id).toBe(a.id);
    expect(grid.getAt({ x: 2, y: 0, z: 0 })?.id).toBe(b.id);
    expect(grid.has({ x: 0, y: 0, z: 0 })).toBe(false);
    expect(grid.size).toBe(2);
  });

  it('bumps version on structural mutation', () => {
    const grid = new VoxelGrid();
    const before = grid.version;
    grid.add({ x: 0, y: 0, z: 0 });
    expect(grid.version).toBeGreaterThan(before);
  });

  it('stores, retrieves and clears a free transform by groupId', () => {
    const grid = new VoxelGrid();
    const transform = { anchorCell: { x: 0, y: 0, z: 0 }, offset: { x: 1, y: 2, z: 3 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };

    expect(grid.getFreeTransform('grp1')).toBeUndefined();
    grid.setFreeTransform('grp1', transform);
    expect(grid.getFreeTransform('grp1')).toEqual(transform);
    expect(grid.freeTransforms().size).toBe(1);

    grid.clearFreeTransform('grp1');
    expect(grid.getFreeTransform('grp1')).toBeUndefined();
    expect(grid.freeTransforms().size).toBe(0);
  });

  it('clear() also wipes free transforms', () => {
    const grid = new VoxelGrid();
    grid.add({ x: 0, y: 0, z: 0 });
    grid.setFreeTransform('grp1', { anchorCell: { x: 0, y: 0, z: 0 }, offset: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } });

    grid.clear();

    expect(grid.size).toBe(0);
    expect(grid.freeTransforms().size).toBe(0);
  });

  it('clone() copies free transforms independently from the original', () => {
    const grid = new VoxelGrid();
    grid.setFreeTransform('grp1', { anchorCell: { x: 0, y: 0, z: 0 }, offset: { x: 1, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } });

    const copy = grid.clone();
    copy.setFreeTransform('grp1', { anchorCell: { x: 0, y: 0, z: 0 }, offset: { x: 9, y: 9, z: 9 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } });

    expect(grid.getFreeTransform('grp1')?.offset).toEqual({ x: 1, y: 0, z: 0 });
    expect(copy.getFreeTransform('grp1')?.offset).toEqual({ x: 9, y: 9, z: 9 });
  });
});
