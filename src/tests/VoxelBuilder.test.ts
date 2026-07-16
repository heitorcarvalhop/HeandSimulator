import { describe, expect, it } from 'vitest';
import { buildLetterRShape, computeCreationLine, computeFreeLine } from '../voxels/VoxelBuilder';

describe('computeCreationLine', () => {
  it('locks a mostly-horizontal drag onto the X axis', () => {
    const line = computeCreationLine({ x: 0, y: 0, z: 0 }, { x: 4, y: 1, z: 0 });
    expect(line.every((c) => c.y === 0 && c.z === 0)).toBe(true);
    expect(line[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(line[line.length - 1]).toEqual({ x: 4, y: 0, z: 0 });
  });

  it('locks a mostly-vertical drag onto the Y axis', () => {
    const line = computeCreationLine({ x: 0, y: 0, z: 0 }, { x: 1, y: -5, z: 0 });
    expect(line.every((c) => c.x === 0 && c.z === 0)).toBe(true);
    expect(line.length).toBe(6);
  });

  it('locks a mostly-depth drag onto the Z axis', () => {
    const line = computeCreationLine({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 3 });
    expect(line.every((c) => c.x === 0 && c.y === 0)).toBe(true);
    expect(line.length).toBe(4);
  });

  it('produces contiguous unit steps with no duplicate cells', () => {
    const line = computeCreationLine({ x: 2, y: 2, z: 2 }, { x: -3, y: 9, z: 2 });
    const keys = line.map((c) => `${c.x}:${c.y}:${c.z}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('computeFreeLine', () => {
  it('delegates straight to the general 3D DDA algorithm', () => {
    const line = computeFreeLine({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 0 });
    expect(line[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(line[line.length - 1]).toEqual({ x: 2, y: 2, z: 0 });
  });
});

describe('buildLetterRShape', () => {
  it('produces a non-empty, duplicate-free set of voxel coordinates', () => {
    const shape = buildLetterRShape();
    expect(shape.length).toBeGreaterThan(0);
    const keys = shape.map((c) => `${c.x}:${c.y}:${c.z}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is roughly centered on the origin', () => {
    const shape = buildLetterRShape({ thickness: 1, depth: 1 });
    const xs = shape.map((c) => c.x);
    const ys = shape.map((c) => c.y);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    expect(Math.abs(centerX)).toBeLessThanOrEqual(1);
    expect(Math.abs(centerY)).toBeLessThanOrEqual(1);
  });

  it('scales the voxel count with thickness and depth', () => {
    const thin = buildLetterRShape({ thickness: 1, depth: 1 });
    const thick = buildLetterRShape({ thickness: 2, depth: 1 });
    const deep = buildLetterRShape({ thickness: 1, depth: 3 });
    expect(thick.length).toBeGreaterThan(thin.length);
    expect(deep.length).toBe(thin.length * 3);
  });

  it('spans exactly one Z layer when depth is 1', () => {
    const shape = buildLetterRShape({ thickness: 1, depth: 1 });
    const zs = new Set(shape.map((c) => c.z));
    expect(zs.size).toBe(1);
  });
});
