import { describe, expect, it } from 'vitest';
import { VoxelGrid } from '../voxels/VoxelGrid';
import {
  findAllConnectedComponents,
  findConnectedComponent,
  findSegmentPath,
  findVoxelsThatWouldFloat,
} from '../voxels/ConnectedComponents';

function buildLine(grid: VoxelGrid, length: number) {
  const ids: string[] = [];
  for (let i = 0; i < length; i++) {
    ids.push(grid.add({ x: i, y: 0, z: 0 })!.id);
  }
  return ids;
}

describe('findConnectedComponent', () => {
  it('returns only the starting voxel when it has no neighbors', () => {
    const grid = new VoxelGrid();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    grid.add({ x: 10, y: 10, z: 10 });
    const component = findConnectedComponent(grid, a.id);
    expect(component).toHaveLength(1);
    expect(component[0].id).toBe(a.id);
  });

  it('flood-fills across a whole connected line of voxels', () => {
    const grid = new VoxelGrid();
    const ids = buildLine(grid, 5);
    const component = findConnectedComponent(grid, ids[2]);
    expect(component).toHaveLength(5);
    expect(new Set(component.map((v) => v.id))).toEqual(new Set(ids));
  });

  it('does not cross a gap between two separate groups', () => {
    const grid = new VoxelGrid();
    const groupA = buildLine(grid, 3); // x = 0,1,2
    grid.add({ x: 5, y: 0, z: 0 }); // disconnected, gap at x=3,4
    const component = findConnectedComponent(grid, groupA[0]);
    expect(component).toHaveLength(3);
  });

  it('flood-fills through all three axes', () => {
    const grid = new VoxelGrid();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    grid.add({ x: 1, y: 0, z: 0 });
    grid.add({ x: 1, y: 1, z: 0 });
    grid.add({ x: 1, y: 1, z: 1 });
    const component = findConnectedComponent(grid, a.id);
    expect(component).toHaveLength(4);
  });
});

describe('findAllConnectedComponents', () => {
  it('splits the grid into independent islands', () => {
    const grid = new VoxelGrid();
    buildLine(grid, 3);
    grid.add({ x: 100, y: 0, z: 0 });
    grid.add({ x: 101, y: 0, z: 0 });
    const components = findAllConnectedComponents(grid);
    expect(components).toHaveLength(2);
    expect(components.map((c) => c.length).sort()).toEqual([2, 3]);
  });
});

describe('findSegmentPath', () => {
  it('resolves the ordered chain between two voxels on a line', () => {
    const grid = new VoxelGrid();
    const ids = buildLine(grid, 6);
    const path = findSegmentPath(grid, ids[1], ids[4]);
    expect(path.map((v) => v.id)).toEqual([ids[1], ids[2], ids[3], ids[4]]);
  });

  it('returns a single-voxel path when start equals end', () => {
    const grid = new VoxelGrid();
    const ids = buildLine(grid, 3);
    const path = findSegmentPath(grid, ids[0], ids[0]);
    expect(path).toHaveLength(1);
  });

  it('returns an empty path when the two voxels are not connected', () => {
    const grid = new VoxelGrid();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    const b = grid.add({ x: 50, y: 50, z: 50 })!;
    const path = findSegmentPath(grid, a.id, b.id);
    expect(path).toHaveLength(0);
  });
});

describe('findVoxelsThatWouldFloat', () => {
  it('detects a voxel that would lose all support if the middle of a line were removed', () => {
    const grid = new VoxelGrid();
    const ids = buildLine(grid, 3); // 0 - 1 - 2
    const floating = findVoxelsThatWouldFloat(grid, new Set([ids[1]]));
    const floatingIds = floating.map((v) => v.id);
    expect(floatingIds).toContain(ids[0]);
    expect(floatingIds).toContain(ids[2]);
  });

  it('reports no floating voxels when removal keeps everything connected', () => {
    const grid = new VoxelGrid();
    const ids = buildLine(grid, 3);
    const floating = findVoxelsThatWouldFloat(grid, new Set([ids[0]]));
    expect(floating).toHaveLength(0);
  });
});
