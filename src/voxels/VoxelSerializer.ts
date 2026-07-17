import type { FreeTransform, Voxel } from './Voxel';
import { VoxelGrid } from './VoxelGrid';

export const SCENE_FORMAT_VERSION = 1;

export interface SerializedVoxel {
  id: string;
  gridX: number;
  gridY: number;
  gridZ: number;
  groupId: string;
  color: string;
}

export interface ModelTransform {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: number;
}

/** Como uma peça segurada (punho fechado + pinça) fica ao ser solta. */
export type PieceReleaseMode = 'snap' | 'free';

export interface SceneSettings {
  voxelSize: number;
  bloomEnabled: boolean;
  sensitivity: number;
  qualityHigh: boolean;
  allowFloatingVoxels: boolean;
  pieceReleaseMode: PieceReleaseMode;
}

export interface SerializedScene {
  formatVersion: number;
  savedAt: string;
  voxels: SerializedVoxel[];
  model: ModelTransform;
  settings: SceneSettings;
  /** Peças soltas no modo de encaixe livre, por groupId. */
  freeTransforms: Record<string, FreeTransform>;
}

export const DEFAULT_MODEL_TRANSFORM: ModelTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: 1,
};

export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  voxelSize: 0.6,
  bloomEnabled: true,
  sensitivity: 1,
  qualityHigh: true,
  allowFloatingVoxels: true,
  pieceReleaseMode: 'snap',
};

export function serializeScene(
  grid: VoxelGrid,
  model: ModelTransform = DEFAULT_MODEL_TRANSFORM,
  settings: SceneSettings = DEFAULT_SCENE_SETTINGS,
): SerializedScene {
  const voxels: SerializedVoxel[] = grid.all().map((v) => ({
    id: v.id,
    gridX: v.gridX,
    gridY: v.gridY,
    gridZ: v.gridZ,
    groupId: v.groupId,
    color: v.color,
  }));

  const freeTransforms: Record<string, FreeTransform> = {};
  for (const [groupId, transform] of grid.freeTransforms()) {
    freeTransforms[groupId] = transform;
  }

  return {
    formatVersion: SCENE_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    voxels,
    model,
    settings,
    freeTransforms,
  };
}

export type SceneValidationResult =
  | { valid: true; scene: SerializedScene }
  | { valid: false; error: string };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVec3Like(value: unknown): value is { x: number; y: number; z: number } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.z);
}

function isQuaternionLike(value: unknown): value is { x: number; y: number; z: number; w: number } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.z) && isFiniteNumber(v.w);
}

function isFreeTransform(value: unknown): value is FreeTransform {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isVec3Like(v.anchorCell) && isVec3Like(v.offset) && isQuaternionLike(v.quaternion);
}

/** Lê `raw.freeTransforms`, descartando silenciosamente entradas malformadas em vez de rejeitar a cena inteira. */
function parseFreeTransforms(value: unknown): Record<string, FreeTransform> {
  const result: Record<string, FreeTransform> = {};
  if (typeof value !== 'object' || value === null) return result;

  for (const [groupId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isFreeTransform(entry)) result[groupId] = entry;
  }
  return result;
}

function isSerializedVoxel(value: unknown): value is SerializedVoxel {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    isFiniteNumber(v.gridX) &&
    isFiniteNumber(v.gridY) &&
    isFiniteNumber(v.gridZ) &&
    typeof v.groupId === 'string' &&
    typeof v.color === 'string'
  );
}

/** Valida (e recupera tolerantemente) uma cena serializada, rejeitando só quando os dados não são confiáveis. */
export function validateSerializedScene(data: unknown): SceneValidationResult {
  if (typeof data !== 'object' || data === null) {
    return { valid: false, error: 'O arquivo não contém um objeto JSON válido.' };
  }

  const raw = data as Record<string, unknown>;

  if (!Array.isArray(raw.voxels)) {
    return { valid: false, error: 'Campo "voxels" ausente ou inválido.' };
  }

  const voxels: SerializedVoxel[] = [];
  const seenKeys = new Set<string>();
  for (const entry of raw.voxels) {
    if (!isSerializedVoxel(entry)) {
      return { valid: false, error: 'Um ou mais voxels possuem formato inválido.' };
    }
    const key = `${Math.round(entry.gridX)}:${Math.round(entry.gridY)}:${Math.round(entry.gridZ)}`;
    if (seenKeys.has(key)) {
      return { valid: false, error: 'Dados corrompidos: voxels duplicados na mesma célula da grade.' };
    }
    seenKeys.add(key);
    voxels.push(entry);
  }

  const model: ModelTransform = isModelTransform(raw.model) ? raw.model : DEFAULT_MODEL_TRANSFORM;
  const settings: SceneSettings = isSceneSettings(raw.settings)
    ? { ...DEFAULT_SCENE_SETTINGS, ...raw.settings }
    : DEFAULT_SCENE_SETTINGS;

  const formatVersion = isFiniteNumber(raw.formatVersion) ? raw.formatVersion : SCENE_FORMAT_VERSION;
  if (formatVersion > SCENE_FORMAT_VERSION) {
    return { valid: false, error: `Versão de dados ${formatVersion} não suportada por esta versão do app.` };
  }

  return {
    valid: true,
    scene: {
      formatVersion: SCENE_FORMAT_VERSION,
      savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date().toISOString(),
      voxels,
      model,
      settings,
      freeTransforms: parseFreeTransforms(raw.freeTransforms),
    },
  };
}

function isModelTransform(value: unknown): value is ModelTransform {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isVec3Like(v.position) && isVec3Like(v.rotation) && isFiniteNumber(v.scale);
}

function isSceneSettings(value: unknown): value is Partial<SceneSettings> {
  return typeof value === 'object' && value !== null;
}

export function loadSceneIntoGrid(scene: SerializedScene, grid: VoxelGrid): void {
  grid.clear();
  for (const v of scene.voxels) {
    const voxel: Voxel = {
      id: v.id,
      gridX: Math.round(v.gridX),
      gridY: Math.round(v.gridY),
      gridZ: Math.round(v.gridZ),
      groupId: v.groupId,
      color: v.color,
      selected: false,
    };
    grid.restore(voxel);
  }
  for (const [groupId, transform] of Object.entries(scene.freeTransforms ?? {})) {
    grid.setFreeTransform(groupId, transform);
  }
}
