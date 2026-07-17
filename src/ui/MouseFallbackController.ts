import * as THREE from 'three';
import type { SceneManager } from '../rendering/SceneManager';
import type { VoxelGrid } from '../voxels/VoxelGrid';
import type { VoxelRenderer } from '../voxels/VoxelRenderer';
import type { ModelTransform } from '../voxels/VoxelSerializer';
import { HistoryManager } from '../history/HistoryManager';
import { AddVoxelsCommand, MoveGroupCommand, type NewVoxelSpec, type GroupMoveEntry } from '../history/VoxelCommands';
import { computeCreationLine } from '../voxels/VoxelBuilder';
import { DEFAULT_VOXEL_COLOR, type GridCoord } from '../voxels/Voxel';
import type { SelectionController } from '../interaction/SelectionController';
import { TransformController, type VoxelDragState } from '../interaction/TransformController';
import { worldToLocalGrid, worldToLocalPoint } from '../interaction/WorldGridMapping';
import { clamp } from '../utils/MathUtils';

export interface MouseFallbackCallbacks {
  onDemoR(): void;
  onClear(): void;
  onToggleDebug(): void;
  onDeleteSelected(): void;
  isCameraFallbackActive(): boolean;
}

const MIN_DEPTH = -3;
const MAX_DEPTH = 3;

/** Fallback por mouse/teclado: clique esquerdo cria/move voxels, direito rotaciona, scroll ajusta profundidade. */
export class MouseFallbackController {
  private depthWorldZ = 0;
  private voxelSize = 0.6;
  private isLeftDragging = false;
  private isRightDragging = false;
  private lastClientPos = { x: 0, y: 0 };

  private creationStartCell: GridCoord | null = null;
  private creationCells: GridCoord[] = [];
  private voxelDrag: VoxelDragState | null = null;

  private readonly transformController = new TransformController();

  constructor(
    private readonly sceneManager: SceneManager,
    private readonly grid: VoxelGrid,
    private readonly voxelRenderer: VoxelRenderer,
    private readonly modelGroup: THREE.Group,
    private readonly transform: ModelTransform,
    private readonly history: HistoryManager,
    private readonly selectionController: SelectionController,
    private readonly callbacks: MouseFallbackCallbacks,
  ) {
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
  }

  dispose(): void {
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private isUiElement(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && Boolean(target.closest('#toolbar, .overlay-screen'));
  }

  private onMouseDown = (event: MouseEvent): void => {
    if (this.isUiElement(event.target) || !this.callbacks.isCameraFallbackActive()) return;
    this.lastClientPos = { x: event.clientX, y: event.clientY };

    if (event.button === 2) {
      this.isRightDragging = true;
      return;
    }

    if (event.button !== 0) return;
    this.isLeftDragging = true;

    const ndc = this.sceneManager.screenPixelToNDC(event.clientX, event.clientY);
    this.sceneManager.raycaster.setFromCamera(ndc, this.sceneManager.camera);
    const hit = this.selectionController.raycastVoxel(this.sceneManager.raycaster, this.modelGroup);

    if (event.shiftKey && hit) {
      const currentlySelected = hit.selected;
      this.grid.setSelected(hit.id, !currentlySelected);
      this.isLeftDragging = false;
      return;
    }

    const worldPos = this.sceneManager.coordinateMapper.screenToWorld(event.clientX, event.clientY, this.depthWorldZ);

    if (hit) {
      this.selectionController.selectSingle(hit.id);
      this.voxelDrag = this.transformController.beginVoxelDrag([hit], worldToLocalPoint(this.modelGroup, worldPos));
      return;
    }

    const startCell = worldToLocalGrid(this.modelGroup, worldPos, this.currentVoxelSize());
    this.creationStartCell = startCell;
    this.creationCells = [startCell];
    this.voxelRenderer.setPreview(this.creationCells, this.collidingKeys(this.creationCells));
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (this.isRightDragging) {
      const dx = event.clientX - this.lastClientPos.x;
      const dy = event.clientY - this.lastClientPos.y;
      this.transform.rotation.y += dx * 0.006;
      this.transform.rotation.x += dy * 0.006;
      this.lastClientPos = { x: event.clientX, y: event.clientY };
      return;
    }

    if (!this.isLeftDragging) return;
    this.lastClientPos = { x: event.clientX, y: event.clientY };

    const worldPos = this.sceneManager.coordinateMapper.screenToWorld(event.clientX, event.clientY, this.depthWorldZ);

    if (this.voxelDrag) {
      const localCursor = worldToLocalPoint(this.modelGroup, worldPos);
      this.transformController.updateVoxelDrag(this.voxelDrag, localCursor, this.currentVoxelSize(), this.grid, true);
      const preview = this.voxelDrag.targets.map((t) => t.proposedCoord);
      const colliding = this.voxelDrag.valid ? new Set<string>() : new Set(preview.map((c) => `${c.x}:${c.y}:${c.z}`));
      this.voxelRenderer.setPreview(preview, colliding);
      return;
    }

    if (this.creationStartCell) {
      const currentCell = worldToLocalGrid(this.modelGroup, worldPos, this.currentVoxelSize());
      this.creationCells = computeCreationLine(this.creationStartCell, currentCell);
      this.voxelRenderer.setPreview(this.creationCells, this.collidingKeys(this.creationCells));
    }
  };

  private onMouseUp = (): void => {
    if (this.isRightDragging) {
      this.isRightDragging = false;
      return;
    }

    if (this.voxelDrag) {
      if (this.voxelDrag.valid) {
        const entries: GroupMoveEntry[] = this.voxelDrag.targets.map((t) => ({
          voxelId: t.voxelId,
          from: t.originalCoord,
          to: t.proposedCoord,
        }));
        const moved = entries.some((e) => e.from.x !== e.to.x || e.from.y !== e.to.y || e.from.z !== e.to.z);
        if (moved) this.history.execute(new MoveGroupCommand(this.grid, entries, 'Mover voxel (mouse)'));
      }
      this.voxelRenderer.clearPreview();
      this.voxelDrag = null;
    } else if (this.creationStartCell) {
      const colliding = this.collidingKeys(this.creationCells);
      const specs: NewVoxelSpec[] = this.creationCells
        .filter((c) => !colliding.has(`${c.x}:${c.y}:${c.z}`))
        .map((c) => ({ coord: c, color: DEFAULT_VOXEL_COLOR }));
      if (specs.length > 0) this.history.execute(new AddVoxelsCommand(this.grid, specs));
      this.voxelRenderer.clearPreview();
    }

    this.isLeftDragging = false;
    this.creationStartCell = null;
    this.creationCells = [];
  };

  private onWheel = (event: WheelEvent): void => {
    if (this.isUiElement(event.target)) return;
    event.preventDefault();
    this.depthWorldZ = clamp(this.depthWorldZ - Math.sign(event.deltaY) * 0.25, MIN_DEPTH, MAX_DEPTH);
  };

  private onContextMenu = (event: MouseEvent): void => {
    if (this.callbacks.isCameraFallbackActive()) event.preventDefault();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      this.callbacks.onDeleteSelected();
    } else if (event.ctrlKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.history.undo();
    } else if (event.ctrlKey && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.history.redo();
    } else if (event.key.toLowerCase() === 'r' && !event.ctrlKey) {
      this.callbacks.onDemoR();
    } else if (event.key.toLowerCase() === 'c' && !event.ctrlKey) {
      this.callbacks.onClear();
    } else if (event.key.toLowerCase() === 'd' && !event.ctrlKey) {
      this.callbacks.onToggleDebug();
    }
  };

  private collidingKeys(cells: GridCoord[]): Set<string> {
    const result = new Set<string>();
    for (const cell of cells) {
      if (this.grid.has(cell)) result.add(`${cell.x}:${cell.y}:${cell.z}`);
    }
    return result;
  }

  private currentVoxelSize(): number {
    return this.voxelSize;
  }

  setVoxelSize(size: number): void {
    this.voxelSize = size;
  }
}
