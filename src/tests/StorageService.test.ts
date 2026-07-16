import { beforeEach, describe, expect, it } from 'vitest';
import { StorageService } from '../storage/StorageService';
import { VoxelGrid } from '../voxels/VoxelGrid';
import { DEFAULT_MODEL_TRANSFORM, DEFAULT_SCENE_SETTINGS } from '../voxels/VoxelSerializer';

describe('StorageService', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reports no saved scene when LocalStorage is empty', () => {
    const storage = new StorageService();
    const result = storage.load();
    expect(result.ok).toBe(false);
  });

  it('saves and reloads a scene round trip', () => {
    const storage = new StorageService();
    const grid = new VoxelGrid();
    grid.add({ x: 0, y: 0, z: 0 }, { color: '#123456' });

    storage.save(grid, DEFAULT_MODEL_TRANSFORM, DEFAULT_SCENE_SETTINGS);
    const result = storage.load();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scene.voxels).toHaveLength(1);
      expect(result.scene.voxels[0].color).toBe('#123456');
    }
  });

  it('recovers gracefully from corrupted JSON in LocalStorage', () => {
    window.localStorage.setItem('holo-voxel-hands:scene:v1', '{not valid json');
    const storage = new StorageService();
    const result = storage.load();
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid JSON string on import', () => {
    const storage = new StorageService();
    const result = storage.importFromJsonString('{ this is not json ');
    expect(result.ok).toBe(false);
  });

  it('rejects a well-formed JSON payload that does not look like a scene', () => {
    const storage = new StorageService();
    const result = storage.importFromJsonString(JSON.stringify({ hello: 'world' }));
    expect(result.ok).toBe(false);
  });

  it('accepts a valid exported scene back on import', () => {
    const storage = new StorageService();
    const grid = new VoxelGrid();
    grid.add({ x: 1, y: 1, z: 1 });
    const json = storage.exportToJsonString(grid, DEFAULT_MODEL_TRANSFORM, DEFAULT_SCENE_SETTINGS);

    const result = storage.importFromJsonString(json);
    expect(result.ok).toBe(true);
  });

  it('clear removes the saved scene', () => {
    const storage = new StorageService();
    const grid = new VoxelGrid();
    storage.save(grid, DEFAULT_MODEL_TRANSFORM, DEFAULT_SCENE_SETTINGS);
    storage.clear();
    expect(storage.load().ok).toBe(false);
  });
});
