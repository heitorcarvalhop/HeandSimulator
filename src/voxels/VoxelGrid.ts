import {
  DEFAULT_VOXEL_COLOR,
  gridKey,
  makeGroupId,
  makeVoxelId,
  NEIGHBOR_OFFSETS,
  type GridCoord,
  type Voxel,
} from './Voxel';

export interface AddVoxelOptions {
  id?: string;
  groupId?: string;
  color?: string;
}

/** Armazena os voxels indexados por coordenada de grade, para lookup e checagem de colisão O(1). */
export class VoxelGrid {
  private readonly byKey = new Map<string, Voxel>();
  private readonly byId = new Map<string, Voxel>();
  /** Incrementado a cada mutação estrutural, para o renderer pular frames sem mudança. */
  version = 0;

  get size(): number {
    return this.byKey.size;
  }

  all(): Voxel[] {
    return Array.from(this.byKey.values());
  }

  get(id: string): Voxel | undefined {
    return this.byId.get(id);
  }

  getAt(coord: GridCoord): Voxel | undefined {
    return this.byKey.get(gridKey(coord.x, coord.y, coord.z));
  }

  has(coord: GridCoord): boolean {
    return this.byKey.has(gridKey(coord.x, coord.y, coord.z));
  }

  hasId(id: string): boolean {
    return this.byId.has(id);
  }

  /** Adiciona um voxel na célula dada. Retorna null se a célula já estiver ocupada. */
  add(coord: GridCoord, options: AddVoxelOptions = {}): Voxel | null {
    if (this.has(coord)) return null;

    const voxel: Voxel = {
      id: options.id ?? makeVoxelId(),
      gridX: coord.x,
      gridY: coord.y,
      gridZ: coord.z,
      groupId: options.groupId ?? makeGroupId(),
      color: options.color ?? DEFAULT_VOXEL_COLOR,
      selected: false,
    };

    this.byKey.set(gridKey(coord.x, coord.y, coord.z), voxel);
    this.byId.set(voxel.id, voxel);
    this.version++;
    return voxel;
  }

  /** Reinsere um voxel já completo (usado pelo undo para restaurar o estado exato anterior). */
  restore(voxel: Voxel): void {
    this.byKey.set(gridKey(voxel.gridX, voxel.gridY, voxel.gridZ), voxel);
    this.byId.set(voxel.id, voxel);
    this.version++;
  }

  remove(id: string): Voxel | null {
    const voxel = this.byId.get(id);
    if (!voxel) return null;
    this.byKey.delete(gridKey(voxel.gridX, voxel.gridY, voxel.gridZ));
    this.byId.delete(id);
    this.version++;
    return voxel;
  }

  /** Move um voxel para outra célula (se estiver livre), mutando o mesmo objeto. */
  move(id: string, target: GridCoord): boolean {
    const voxel = this.byId.get(id);
    if (!voxel) return false;
    const targetKey = gridKey(target.x, target.y, target.z);
    const occupant = this.byKey.get(targetKey);
    if (occupant && occupant.id !== id) return false;

    this.byKey.delete(gridKey(voxel.gridX, voxel.gridY, voxel.gridZ));
    voxel.gridX = target.x;
    voxel.gridY = target.y;
    voxel.gridZ = target.z;
    this.byKey.set(targetKey, voxel);
    this.version++;
    return true;
  }

  setGroup(id: string, groupId: string): void {
    const voxel = this.byId.get(id);
    if (!voxel) return;
    voxel.groupId = groupId;
    this.version++;
  }

  setSelected(id: string, selected: boolean): void {
    const voxel = this.byId.get(id);
    if (!voxel) return;
    voxel.selected = selected;
    this.version++;
  }

  clearSelection(): void {
    let changed = false;
    for (const voxel of this.byKey.values()) {
      if (voxel.selected) {
        voxel.selected = false;
        changed = true;
      }
    }
    if (changed) this.version++;
  }

  selected(): Voxel[] {
    return this.all().filter((v) => v.selected);
  }

  neighbors(coord: GridCoord): Voxel[] {
    const result: Voxel[] = [];
    for (const offset of NEIGHBOR_OFFSETS) {
      const voxel = this.byKey.get(gridKey(coord.x + offset.x, coord.y + offset.y, coord.z + offset.z));
      if (voxel) result.push(voxel);
    }
    return result;
  }

  /** Verdadeiro se a célula tem ao menos um vizinho ocupado adjacente por face. */
  hasSupport(coord: GridCoord): boolean {
    return this.neighbors(coord).length > 0;
  }

  clear(): void {
    if (this.byKey.size === 0) return;
    this.byKey.clear();
    this.byId.clear();
    this.version++;
  }

  clone(): VoxelGrid {
    const copy = new VoxelGrid();
    for (const voxel of this.byKey.values()) {
      copy.restore({ ...voxel });
    }
    return copy;
  }
}
