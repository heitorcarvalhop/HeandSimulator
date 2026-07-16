import { describe, expect, it } from 'vitest';
import { VoxelGrid } from '../voxels/VoxelGrid';
import { VoxelRenderer } from '../voxels/VoxelRenderer';
import { SelectionController } from '../interaction/SelectionController';

function makeController() {
  const grid = new VoxelGrid();
  const renderer = new VoxelRenderer(0.6);
  const selection = new SelectionController(grid, renderer);
  return { grid, selection };
}

describe('SelectionController segment selection', () => {
  it('does not resolve a segment on the first anchor pick', () => {
    const { grid, selection } = makeController();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    const resolved = selection.pickSegmentAnchor(a.id);
    expect(resolved).toBe(false);
    expect(selection.hasPendingSegmentAnchor).toBe(true);
  });

  it('selects the whole chain between two anchors on the second pick', () => {
    const { grid, selection } = makeController();
    const ids = [0, 1, 2, 3, 4].map((x) => grid.add({ x, y: 0, z: 0 })!.id);

    selection.pickSegmentAnchor(ids[1]);
    const resolved = selection.pickSegmentAnchor(ids[3]);

    expect(resolved).toBe(true);
    expect(selection.hasPendingSegmentAnchor).toBe(false);
    const selected = grid.selected().map((v) => v.id);
    expect(new Set(selected)).toEqual(new Set([ids[1], ids[2], ids[3]]));
  });

  it('keeps only the first anchor highlighted when the two anchors are not connected', () => {
    const { grid, selection } = makeController();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    const b = grid.add({ x: 50, y: 50, z: 50 })!;

    selection.pickSegmentAnchor(a.id);
    const resolved = selection.pickSegmentAnchor(b.id);

    expect(resolved).toBe(false);
    // A primeira âncora fica selecionada como feedback pendente; a resolução do segmento
    // não teve sucesso, então pickSegmentAnchor precisa ser chamado de novo com um par válido.
    expect(grid.selected().map((v) => v.id)).toEqual([a.id]);
  });

  it('selectSingle clears any previous selection', () => {
    const { grid, selection } = makeController();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    const b = grid.add({ x: 1, y: 0, z: 0 })!;
    selection.selectMany([a.id, b.id]);
    expect(grid.selected()).toHaveLength(2);

    selection.selectSingle(a.id);
    expect(grid.selected()).toHaveLength(1);
    expect(grid.selected()[0].id).toBe(a.id);
  });
});
