import { describe, expect, it } from 'vitest';
import { angleDelta, clamp, dda3D, dominantAxis, roundToNearest } from '../utils/MathUtils';

describe('clamp', () => {
  it('keeps values inside the range unchanged', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps values below the minimum', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps values above the maximum', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('roundToNearest', () => {
  it('snaps to the nearest step', () => {
    expect(roundToNearest(0.62, 0.5)).toBe(0.5);
    expect(roundToNearest(0.8, 0.5)).toBe(1);
  });
});

describe('angleDelta', () => {
  it('returns a small positive delta for a small forward rotation', () => {
    expect(angleDelta(0, 0.1)).toBeCloseTo(0.1, 5);
  });

  it('wraps around the +-PI boundary to the shortest path', () => {
    const delta = angleDelta(Math.PI - 0.1, -Math.PI + 0.1);
    expect(delta).toBeCloseTo(0.2, 5);
  });
});

describe('dominantAxis', () => {
  it('picks x when the x movement is largest', () => {
    expect(dominantAxis({ x: 5, y: 1, z: 0 })).toBe('x');
  });

  it('picks y when the y movement is largest', () => {
    expect(dominantAxis({ x: 1, y: -5, z: 2 })).toBe('y');
  });

  it('picks z when the z movement is largest', () => {
    expect(dominantAxis({ x: 0, y: 1, z: -4 })).toBe('z');
  });
});

describe('dda3D', () => {
  it('returns a single point when start equals end', () => {
    const points = dda3D({ x: 2, y: 2, z: 2 }, { x: 2, y: 2, z: 2 });
    expect(points).toEqual([{ x: 2, y: 2, z: 2 }]);
  });

  it('walks a straight horizontal line with unit steps and no duplicates', () => {
    const points = dda3D({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 });
    expect(points).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ]);
  });

  it('walks a straight vertical line', () => {
    const points = dda3D({ x: 0, y: 0, z: 0 }, { x: 0, y: -3, z: 0 });
    expect(points.map((p) => p.y)).toEqual([0, -1, -2, -3]);
    expect(points.every((p) => p.x === 0 && p.z === 0)).toBe(true);
  });

  it('walks a diagonal line covering every axis without gaps', () => {
    const points = dda3D({ x: 0, y: 0, z: 0 }, { x: 3, y: 3, z: 3 });
    expect(points[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(points[points.length - 1]).toEqual({ x: 3, y: 3, z: 3 });
    for (let i = 1; i < points.length; i++) {
      const step = Math.max(
        Math.abs(points[i].x - points[i - 1].x),
        Math.abs(points[i].y - points[i - 1].y),
        Math.abs(points[i].z - points[i - 1].z),
      );
      expect(step).toBeLessThanOrEqual(1);
    }
  });
});
