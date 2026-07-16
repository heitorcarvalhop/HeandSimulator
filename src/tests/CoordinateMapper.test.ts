import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CoordinateMapper } from '../rendering/CoordinateMapper';

function makeMapper(): CoordinateMapper {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  camera.position.set(0, 0, 6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const mapper = new CoordinateMapper(camera);
  mapper.updateViewportSize(1280, 720);
  mapper.updateVideoSize(1280, 720);
  return mapper;
}

describe('CoordinateMapper', () => {
  it('round-trips screenToWorld -> worldToScreen back to the same pixel', () => {
    const mapper = makeMapper();
    const world = mapper.screenToWorld(640, 360, 0);
    const screen = mapper.worldToScreen(world);
    expect(screen.x).toBeCloseTo(640, 1);
    expect(screen.y).toBeCloseTo(360, 1);
  });

  it('maps the viewport center to world (0,0) on the baseZ plane', () => {
    const mapper = makeMapper();
    const world = mapper.screenToWorld(640, 360, 0);
    expect(world.x).toBeCloseTo(0, 5);
    expect(world.y).toBeCloseTo(0, 5);
    expect(world.z).toBeCloseTo(0, 5);
  });

  it('maps left-of-center screen positions to negative world X', () => {
    const mapper = makeMapper();
    const world = mapper.screenToWorld(100, 360, 0);
    expect(world.x).toBeLessThan(0);
  });

  it('does not distort video-to-viewport mapping when aspect ratios match (no cropping)', () => {
    const mapper = makeMapper();
    const result = mapper.videoNormalizedToViewportNormalized(0.5, 0.5);
    expect(result.x).toBeCloseTo(0.5, 5);
    expect(result.y).toBeCloseTo(0.5, 5);
  });

  it('crops correctly when the video is a different aspect ratio than the viewport (object-fit: cover)', () => {
    const mapper = makeMapper();
    // Vídeo retrato mapeado num viewport paisagem é cortado no eixo Y.
    mapper.updateVideoSize(720, 1280);
    const center = mapper.videoNormalizedToViewportNormalized(0.5, 0.5);
    expect(center.x).toBeCloseTo(0.5, 3);
    expect(center.y).toBeCloseTo(0.5, 3);
  });

  it('clamps computed depth to the configured min/max range', () => {
    const mapper = makeMapper();
    mapper.setDepthConfig({ minZ: -1, maxZ: 1, depthMultiplier: 100, baseZ: 0 });
    const world = mapper.landmarkToWorld({ x: 0.5, y: 0.5, z: -0.5 });
    expect(world.z).toBeLessThanOrEqual(1);
    expect(world.z).toBeGreaterThanOrEqual(-1);
  });
});

describe('CoordinateMapper grid conversion', () => {
  it('worldToGrid rounds to the nearest cell for a given voxel size', () => {
    const mapper = makeMapper();
    const grid = mapper.worldToGrid(new THREE.Vector3(1.24, -0.6, 0.05), 0.6);
    expect(grid).toEqual({ x: 2, y: -1, z: 0 });
  });

  it('gridToWorld is the exact inverse of worldToGrid for on-grid points', () => {
    const mapper = makeMapper();
    const world = mapper.gridToWorld(3, -2, 1, 0.5);
    expect(world.x).toBeCloseTo(1.5, 5);
    expect(world.y).toBeCloseTo(-1, 5);
    expect(world.z).toBeCloseTo(0.5, 5);

    const backToGrid = mapper.worldToGrid(world, 0.5);
    expect(backToGrid).toEqual({ x: 3, y: -2, z: 1 });
  });
});
