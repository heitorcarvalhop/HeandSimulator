import { NEIGHBOR_OFFSETS, type Voxel } from './Voxel';
import type { VoxelGrid } from './VoxelGrid';

/** Busca em largura (BFS) pelos voxels conectados por face a partir de um id inicial. */
export function findConnectedComponent(grid: VoxelGrid, startVoxelId: string): Voxel[] {
  const start = grid.get(startVoxelId);
  if (!start) return [];

  const visited = new Set<string>([start.id]);
  const queue: Voxel[] = [start];
  const result: Voxel[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = grid.getAt({
        x: current.gridX + offset.x,
        y: current.gridY + offset.y,
        z: current.gridZ + offset.z,
      });
      if (neighbor && !visited.has(neighbor.id)) {
        visited.add(neighbor.id);
        queue.push(neighbor);
      }
    }
  }

  return result;
}

/** Divide toda a grade em seus componentes conectados independentes. */
export function findAllConnectedComponents(grid: VoxelGrid): Voxel[][] {
  const visited = new Set<string>();
  const components: Voxel[][] = [];

  for (const voxel of grid.all()) {
    if (visited.has(voxel.id)) continue;
    const component = findConnectedComponent(grid, voxel.id);
    for (const v of component) visited.add(v.id);
    components.push(component);
  }

  return components;
}

/** Caminho mais curto entre dois voxels (BFS), usado pela seleção de segmento (início/fim). */
export function findSegmentPath(grid: VoxelGrid, startVoxelId: string, endVoxelId: string): Voxel[] {
  const start = grid.get(startVoxelId);
  const end = grid.get(endVoxelId);
  if (!start || !end) return [];
  if (start.id === end.id) return [start];

  const cameFrom = new Map<string, string>();
  const visited = new Set<string>([start.id]);
  const queue: Voxel[] = [start];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.id === end.id) {
      return reconstructPath(grid, cameFrom, start.id, end.id);
    }

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = grid.getAt({
        x: current.gridX + offset.x,
        y: current.gridY + offset.y,
        z: current.gridZ + offset.z,
      });
      if (neighbor && !visited.has(neighbor.id)) {
        visited.add(neighbor.id);
        cameFrom.set(neighbor.id, current.id);
        queue.push(neighbor);
      }
    }
  }

  return [];
}

function reconstructPath(
  grid: VoxelGrid,
  cameFrom: Map<string, string>,
  startId: string,
  endId: string,
): Voxel[] {
  const path: Voxel[] = [];
  let currentId: string | undefined = endId;
  while (currentId !== undefined) {
    const voxel = grid.get(currentId);
    if (voxel) path.unshift(voxel);
    if (currentId === startId) break;
    currentId = cameFrom.get(currentId);
  }
  return path;
}

/** Voxels que ficariam sem nenhum vizinho de suporte se `removedIds` fossem removidos. */
export function findVoxelsThatWouldFloat(grid: VoxelGrid, removedIds: Set<string>): Voxel[] {
  const floating: Voxel[] = [];
  for (const voxel of grid.all()) {
    if (removedIds.has(voxel.id)) continue;
    const stillHasSupport = NEIGHBOR_OFFSETS.some((offset) => {
      const neighbor = grid.getAt({
        x: voxel.gridX + offset.x,
        y: voxel.gridY + offset.y,
        z: voxel.gridZ + offset.z,
      });
      return neighbor && !removedIds.has(neighbor.id);
    });
    if (!stillHasSupport) floating.push(voxel);
  }
  return floating;
}
