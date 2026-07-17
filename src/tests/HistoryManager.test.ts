import { describe, expect, it } from 'vitest';
import { HistoryManager } from '../history/HistoryManager';
import {
  AddVoxelsCommand,
  ClearAllCommand,
  CompositeCommand,
  MoveGroupCommand,
  RemoveVoxelsCommand,
  ScaleModelCommand,
  SetFreeTransformCommand,
  type GroupMoveEntry,
} from '../history/VoxelCommands';
import { VoxelGrid } from '../voxels/VoxelGrid';
import { DEFAULT_MODEL_TRANSFORM, type ModelTransform } from '../voxels/VoxelSerializer';

describe('HistoryManager + VoxelCommands', () => {
  it('undo reverses an AddVoxelsCommand and redo re-applies it', () => {
    const grid = new VoxelGrid();
    const history = new HistoryManager();
    const command = new AddVoxelsCommand(grid, [{ coord: { x: 0, y: 0, z: 0 }, color: '#fff' }]);

    history.execute(command);
    expect(grid.size).toBe(1);

    history.undo();
    expect(grid.size).toBe(0);

    history.redo();
    expect(grid.size).toBe(1);
  });

  it('undo of RemoveVoxelsCommand restores the exact removed voxel', () => {
    const grid = new VoxelGrid();
    const voxel = grid.add({ x: 2, y: 3, z: 4 }, { color: '#abcdef' })!;
    const history = new HistoryManager();

    history.execute(new RemoveVoxelsCommand(grid, [voxel.id]));
    expect(grid.size).toBe(0);

    history.undo();
    expect(grid.size).toBe(1);
    expect(grid.get(voxel.id)?.color).toBe('#abcdef');
    expect(grid.get(voxel.id)?.gridX).toBe(2);
  });

  it('undo of MoveGroupCommand restores every voxel to its original cell', () => {
    const grid = new VoxelGrid();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    const b = grid.add({ x: 1, y: 0, z: 0 })!;
    const history = new HistoryManager();

    const entries: GroupMoveEntry[] = [
      { voxelId: a.id, from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 5, z: 0 } },
      { voxelId: b.id, from: { x: 1, y: 0, z: 0 }, to: { x: 1, y: 5, z: 0 } },
    ];
    history.execute(new MoveGroupCommand(grid, entries));

    expect(grid.getAt({ x: 0, y: 5, z: 0 })?.id).toBe(a.id);
    history.undo();
    expect(grid.getAt({ x: 0, y: 0, z: 0 })?.id).toBe(a.id);
    expect(grid.getAt({ x: 1, y: 0, z: 0 })?.id).toBe(b.id);
  });

  it('MoveGroupCommand shifts a row by one cell without a transient self-collision, and undo restores it', () => {
    const grid = new VoxelGrid();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    const b = grid.add({ x: 1, y: 0, z: 0 })!;
    const history = new HistoryManager();

    // O alvo de "a" é a célula que "b" ainda ocupa nesse instante — sem moveMany por baixo,
    // grid.move rejeitaria "a" por colisão transitória com "b" (que ainda não se moveu).
    const entries: GroupMoveEntry[] = [
      { voxelId: a.id, from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 0, z: 0 } },
      { voxelId: b.id, from: { x: 1, y: 0, z: 0 }, to: { x: 2, y: 0, z: 0 } },
    ];
    history.execute(new MoveGroupCommand(grid, entries));

    expect(grid.getAt({ x: 1, y: 0, z: 0 })?.id).toBe(a.id);
    expect(grid.getAt({ x: 2, y: 0, z: 0 })?.id).toBe(b.id);

    history.undo();
    expect(grid.getAt({ x: 0, y: 0, z: 0 })?.id).toBe(a.id);
    expect(grid.getAt({ x: 1, y: 0, z: 0 })?.id).toBe(b.id);
  });

  it('ClearAllCommand snapshot/restore round-trips every voxel', () => {
    const grid = new VoxelGrid();
    grid.add({ x: 0, y: 0, z: 0 }, { color: '#111111' });
    grid.add({ x: 1, y: 0, z: 0 }, { color: '#222222' });
    const history = new HistoryManager();

    history.execute(new ClearAllCommand(grid));
    expect(grid.size).toBe(0);

    history.undo();
    expect(grid.size).toBe(2);
    expect(grid.getAt({ x: 0, y: 0, z: 0 })?.color).toBe('#111111');
  });

  it('executing a new command clears the redo stack', () => {
    const grid = new VoxelGrid();
    const history = new HistoryManager();
    history.execute(new AddVoxelsCommand(grid, [{ coord: { x: 0, y: 0, z: 0 }, color: '#fff' }]));
    history.undo();
    expect(history.canRedo).toBe(true);

    history.execute(new AddVoxelsCommand(grid, [{ coord: { x: 9, y: 9, z: 9 }, color: '#fff' }]));
    expect(history.canRedo).toBe(false);
  });

  it('CompositeCommand undoes its sub-commands in reverse order as one step', () => {
    const transform: ModelTransform = { ...DEFAULT_MODEL_TRANSFORM, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
    const history = new HistoryManager();
    const composite = new CompositeCommand([new ScaleModelCommand(transform, 1, 2)], 'test composite');

    history.execute(composite);
    expect(transform.scale).toBe(2);
    history.undo();
    expect(transform.scale).toBe(1);
    expect(history.canUndo).toBe(false);
  });

  it('SetFreeTransformCommand grants and undo restores the previous (absent) free transform', () => {
    const grid = new VoxelGrid();
    const history = new HistoryManager();
    const transform = { anchorCell: { x: 0, y: 0, z: 0 }, offset: { x: 1, y: 2, z: 3 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };

    history.execute(new SetFreeTransformCommand(grid, 'grp1', null, transform));
    expect(grid.getFreeTransform('grp1')).toEqual(transform);

    history.undo();
    expect(grid.getFreeTransform('grp1')).toBeUndefined();

    history.redo();
    expect(grid.getFreeTransform('grp1')).toEqual(transform);
  });

  it('undo/redo are no-ops on empty stacks', () => {
    const history = new HistoryManager();
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
  });
});
