import { describe, expect, it } from 'vitest';
import { VoxelGrid } from '../voxels/VoxelGrid';
import {
  loadSceneIntoGrid,
  SCENE_FORMAT_VERSION,
  serializeScene,
  validateSerializedScene,
  DEFAULT_MODEL_TRANSFORM,
  DEFAULT_SCENE_SETTINGS,
} from '../voxels/VoxelSerializer';

describe('serializeScene / validateSerializedScene round trip', () => {
  it('serializes every voxel and validates cleanly', () => {
    const grid = new VoxelGrid();
    grid.add({ x: 0, y: 0, z: 0 }, { color: '#111111' });
    grid.add({ x: 1, y: 2, z: 3 }, { color: '#222222' });

    const scene = serializeScene(grid, DEFAULT_MODEL_TRANSFORM, DEFAULT_SCENE_SETTINGS);
    expect(scene.voxels).toHaveLength(2);
    expect(scene.formatVersion).toBe(SCENE_FORMAT_VERSION);

    const result = validateSerializedScene(JSON.parse(JSON.stringify(scene)));
    expect(result.valid).toBe(true);
  });

  it('loadSceneIntoGrid reproduces the exact same grid contents', () => {
    const grid = new VoxelGrid();
    grid.add({ x: 0, y: 0, z: 0 }, { color: '#111111' });
    grid.add({ x: -3, y: 4, z: -1 }, { color: '#333333' });
    const scene = serializeScene(grid);

    const restored = new VoxelGrid();
    loadSceneIntoGrid(scene, restored);

    expect(restored.size).toBe(2);
    expect(restored.getAt({ x: -3, y: 4, z: -1 })?.color).toBe('#333333');
  });

  it('round-trips a free transform (piece released in "livre" mode) through save/load', () => {
    const grid = new VoxelGrid();
    grid.add({ x: 0, y: 0, z: 0 }, { groupId: 'piece' });
    const transform = { anchorCell: { x: 0, y: 0, z: 0 }, offset: { x: 1.5, y: 0, z: 0 }, quaternion: { x: 0, y: 0.7071, z: 0, w: 0.7071 } };
    grid.setFreeTransform('piece', transform);

    const scene = serializeScene(grid);
    expect(scene.freeTransforms.piece).toEqual(transform);

    const parsedScene = JSON.parse(JSON.stringify(scene));
    const result = validateSerializedScene(parsedScene);
    expect(result.valid).toBe(true);

    const restored = new VoxelGrid();
    if (result.valid) loadSceneIntoGrid(result.scene, restored);
    expect(restored.getFreeTransform('piece')).toEqual(transform);
  });
});

describe('validateSerializedScene', () => {
  it('rejects non-object payloads', () => {
    const result = validateSerializedScene('not an object');
    expect(result.valid).toBe(false);
  });

  it('rejects a payload missing the voxels array', () => {
    const result = validateSerializedScene({ formatVersion: 1 });
    expect(result.valid).toBe(false);
  });

  it('rejects malformed voxel entries', () => {
    const result = validateSerializedScene({ voxels: [{ id: 'x' }] });
    expect(result.valid).toBe(false);
  });

  it('rejects duplicate voxels occupying the same grid cell (corrupted data)', () => {
    const result = validateSerializedScene({
      voxels: [
        { id: 'a', gridX: 0, gridY: 0, gridZ: 0, groupId: 'g', color: '#fff' },
        { id: 'b', gridX: 0, gridY: 0, gridZ: 0, groupId: 'g', color: '#fff' },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a payload from a newer, unsupported format version', () => {
    const result = validateSerializedScene({ formatVersion: 999, voxels: [] });
    expect(result.valid).toBe(false);
  });

  it('falls back to default model/settings when they are missing', () => {
    const result = validateSerializedScene({ voxels: [] });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.scene.model).toEqual(DEFAULT_MODEL_TRANSFORM);
      expect(result.scene.settings.voxelSize).toBe(DEFAULT_SCENE_SETTINGS.voxelSize);
      expect(result.scene.settings.pieceReleaseMode).toBe('snap');
    }
  });

  it('accepts a valid empty scene', () => {
    const result = validateSerializedScene({ voxels: [] });
    expect(result.valid).toBe(true);
  });

  it('loads an older save with no freeTransforms field at all (backward compatibility)', () => {
    const result = validateSerializedScene({
      voxels: [{ id: 'a', gridX: 0, gridY: 0, gridZ: 0, groupId: 'g', color: '#fff' }],
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.scene.freeTransforms).toEqual({});
  });

  it('drops malformed freeTransforms entries instead of rejecting the whole scene', () => {
    const result = validateSerializedScene({
      voxels: [],
      freeTransforms: {
        good: { anchorCell: { x: 0, y: 0, z: 0 }, offset: { x: 1, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
        bad: { offset: 'not a vector' },
      },
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(Object.keys(result.scene.freeTransforms)).toEqual(['good']);
    }
  });
});
