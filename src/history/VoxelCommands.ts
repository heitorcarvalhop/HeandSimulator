import type { GridCoord, Voxel } from '../voxels/Voxel';
import type { VoxelGrid } from '../voxels/VoxelGrid';
import type { ModelTransform } from '../voxels/VoxelSerializer';
import type { Command } from './Command';

export interface NewVoxelSpec {
  coord: GridCoord;
  color: string;
  groupId?: string;
}

/** Adiciona um lote de voxels (linha de criação, letra R etc). Pula células já ocupadas. */
export class AddVoxelsCommand implements Command {
  readonly label = 'Adicionar voxels';
  private addedIds: string[] = [];

  constructor(
    private readonly grid: VoxelGrid,
    private readonly specs: NewVoxelSpec[],
  ) {}

  execute(): void {
    this.addedIds = [];
    for (const spec of this.specs) {
      const voxel = this.grid.add(spec.coord, { color: spec.color, groupId: spec.groupId });
      if (voxel) this.addedIds.push(voxel.id);
    }
  }

  undo(): void {
    for (const id of this.addedIds) this.grid.remove(id);
    this.addedIds = [];
  }
}

export class RemoveVoxelsCommand implements Command {
  readonly label = 'Remover voxels';
  private removed: Voxel[] = [];

  constructor(
    private readonly grid: VoxelGrid,
    private readonly ids: string[],
  ) {}

  execute(): void {
    this.removed = [];
    for (const id of this.ids) {
      const voxel = this.grid.remove(id);
      if (voxel) this.removed.push(voxel);
    }
  }

  undo(): void {
    for (const voxel of this.removed) this.grid.restore(voxel);
  }
}

export class MoveVoxelCommand implements Command {
  readonly label = 'Mover voxel';

  constructor(
    private readonly grid: VoxelGrid,
    private readonly voxelId: string,
    private readonly from: GridCoord,
    private readonly to: GridCoord,
  ) {}

  execute(): void {
    this.grid.move(this.voxelId, this.to);
  }

  undo(): void {
    this.grid.move(this.voxelId, this.from);
  }
}

export interface GroupMoveEntry {
  voxelId: string;
  from: GridCoord;
  to: GridCoord;
}

/** Move um lote de voxels (componente conectado, segmento ou modelo inteiro) atomicamente. */
export class MoveGroupCommand implements Command {
  readonly label: string;

  constructor(
    private readonly grid: VoxelGrid,
    private readonly entries: GroupMoveEntry[],
    label = 'Mover grupo',
  ) {
    this.label = label;
  }

  execute(): void {
    for (const entry of this.entries) this.grid.move(entry.voxelId, entry.to);
  }

  undo(): void {
    for (const entry of this.entries) this.grid.move(entry.voxelId, entry.from);
  }
}

export class MoveModelCommand implements Command {
  readonly label = 'Mover modelo';

  constructor(
    private readonly transform: ModelTransform,
    private readonly from: { x: number; y: number; z: number },
    private readonly to: { x: number; y: number; z: number },
  ) {}

  execute(): void {
    this.transform.position.x = this.to.x;
    this.transform.position.y = this.to.y;
    this.transform.position.z = this.to.z;
  }

  undo(): void {
    this.transform.position.x = this.from.x;
    this.transform.position.y = this.from.y;
    this.transform.position.z = this.from.z;
  }
}

export class RotateModelCommand implements Command {
  readonly label = 'Rotacionar modelo';

  constructor(
    private readonly transform: ModelTransform,
    private readonly from: { x: number; y: number; z: number },
    private readonly to: { x: number; y: number; z: number },
  ) {}

  execute(): void {
    this.transform.rotation.x = this.to.x;
    this.transform.rotation.y = this.to.y;
    this.transform.rotation.z = this.to.z;
  }

  undo(): void {
    this.transform.rotation.x = this.from.x;
    this.transform.rotation.y = this.from.y;
    this.transform.rotation.z = this.from.z;
  }
}

export class ScaleModelCommand implements Command {
  readonly label = 'Redimensionar modelo';

  constructor(
    private readonly transform: ModelTransform,
    private readonly from: number,
    private readonly to: number,
  ) {}

  execute(): void {
    this.transform.scale = this.to;
  }

  undo(): void {
    this.transform.scale = this.from;
  }
}

/** Agrupa vários comandos para desfazer/refazer juntos como uma única entrada do histórico. */
export class CompositeCommand implements Command {
  readonly label: string;

  constructor(
    private readonly commands: Command[],
    label = 'Ação composta',
  ) {
    this.label = label;
  }

  execute(): void {
    for (const command of this.commands) command.execute();
  }

  undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].undo();
  }
}

export class ClearAllCommand implements Command {
  readonly label = 'Limpar tudo';
  private snapshot: Voxel[] = [];

  constructor(private readonly grid: VoxelGrid) {}

  execute(): void {
    this.snapshot = this.grid.all().map((v) => ({ ...v }));
    this.grid.clear();
  }

  undo(): void {
    for (const voxel of this.snapshot) this.grid.restore({ ...voxel });
  }
}
