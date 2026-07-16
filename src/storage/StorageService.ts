import type { VoxelGrid } from '../voxels/VoxelGrid';
import {
  loadSceneIntoGrid,
  serializeScene,
  validateSerializedScene,
  type ModelTransform,
  type SceneSettings,
  type SerializedScene,
} from '../voxels/VoxelSerializer';

const STORAGE_KEY = 'holo-voxel-hands:scene:v1';

export type LoadResult =
  | { ok: true; scene: SerializedScene }
  | { ok: false; error: string };

/** Persistência em LocalStorage e import/export de JSON. Validação fica em VoxelSerializer. */
export class StorageService {
  save(grid: VoxelGrid, model: ModelTransform, settings: SceneSettings): void {
    const scene = serializeScene(grid, model, settings);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
    } catch (error) {
      console.warn('Falha ao salvar no LocalStorage:', error);
    }
  }

  load(): LoadResult {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return { ok: false, error: `Não foi possível acessar o LocalStorage: ${(error as Error).message}` };
    }

    if (!raw) return { ok: false, error: 'Nenhuma cena salva foi encontrada.' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'Os dados salvos estão corrompidos (JSON inválido).' };
    }

    const validation = validateSerializedScene(parsed);
    if (!validation.valid) return { ok: false, error: validation.error };

    return { ok: true, scene: validation.scene };
  }

  applyToGrid(scene: SerializedScene, grid: VoxelGrid): void {
    loadSceneIntoGrid(scene, grid);
  }

  clear(): void {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn('Falha ao limpar o LocalStorage:', error);
    }
  }

  exportToJsonString(grid: VoxelGrid, model: ModelTransform, settings: SceneSettings): string {
    return JSON.stringify(serializeScene(grid, model, settings), null, 2);
  }

  importFromJsonString(json: string): LoadResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, error: 'Arquivo inválido: não é um JSON bem formado.' };
    }

    const validation = validateSerializedScene(parsed);
    if (!validation.valid) return { ok: false, error: validation.error };
    return { ok: true, scene: validation.scene };
  }
}
