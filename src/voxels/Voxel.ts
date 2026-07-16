export interface Voxel {
  id: string;
  gridX: number;
  gridY: number;
  gridZ: number;
  groupId: string;
  color: string;
  selected: boolean;
}

export interface GridCoord {
  x: number;
  y: number;
  z: number;
}

export function gridKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

export function voxelKey(voxel: Voxel): string {
  return gridKey(voxel.gridX, voxel.gridY, voxel.gridZ);
}

export function makeVoxelId(): string {
  return `vx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function makeGroupId(): string {
  return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export const NEIGHBOR_OFFSETS: GridCoord[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

export const DEFAULT_VOXEL_COLOR = '#1adfff';
export const SELECTED_VOXEL_COLOR = '#ffe066';
export const SEGMENT_VOXEL_COLOR = '#ffd54a';
export const PREVIEW_VALID_COLOR = '#3af0ff';
export const PREVIEW_COLLISION_COLOR = '#ff4d4d';
