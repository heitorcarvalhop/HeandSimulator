import * as THREE from 'three';
import { GestureType, type HandFrame } from '../hand-tracking/HandTypes';
import type { StableGesture } from '../hand-tracking/GestureStateMachine';
import type { CoordinateMapper } from '../rendering/CoordinateMapper';
import { findConnectedComponent } from '../voxels/ConnectedComponents';
import { computeCreationLine } from '../voxels/VoxelBuilder';
import { DEFAULT_VOXEL_COLOR, makeGroupId, type GridCoord } from '../voxels/Voxel';
import type { VoxelGrid } from '../voxels/VoxelGrid';
import type { VoxelRenderer } from '../voxels/VoxelRenderer';
import type { ModelTransform } from '../voxels/VoxelSerializer';
import { HistoryManager } from '../history/HistoryManager';
import type { Command } from '../history/Command';
import { AddVoxelsCommand, CompositeCommand, MoveGroupCommand, RemoveVoxelsCommand, RotateModelCommand, ScaleModelCommand, MoveModelCommand, type GroupMoveEntry, type NewVoxelSpec } from '../history/VoxelCommands';
import { CursorController, type HandCursor } from './CursorController';
import { SelectionController } from './SelectionController';
import { TransformController, type ModelDragState, type TwoHandDragState, type VoxelDragState } from './TransformController';
import { EMPTY_OWNERSHIP, InteractionState, type InteractionMode, type InteractionOwnership } from './InteractionTypes';

const GROUP_UPGRADE_MS = 500;
const HAND_LOST_GRACE_MS = 400;
const MODEL_PROXIMITY_MARGIN = 1.4;
const SINGLE_HAND_ROTATE_SENSITIVITY = 0.006;

export interface InteractionFrameResult {
  state: InteractionState;
  ownership: InteractionOwnership;
  cursors: HandCursor[];
  hoveredVoxelId: string | null;
  hintText: string;
}

/** Motor de estados central: toda mutação da grade ou do transform do modelo passa por aqui. */
export class InteractionController {
  private ownership: InteractionOwnership = { ...EMPTY_OWNERSHIP };
  private mode: InteractionMode = 'automatic';
  private allowFloatingVoxels = true;

  private readonly cursorController: CursorController;
  private readonly transformController = new TransformController();
  readonly selectionController: SelectionController;

  private readonly lastSeen = new Map<string, number>();
  private readonly previousGestureType = new Map<string, GestureType>();
  private readonly lastKnownGesture = new Map<string, StableGesture>();
  private readonly lastScreenPos = new Map<string, { x: number; y: number }>();

  private creationStartCell: GridCoord | null = null;
  private creationCells: GridCoord[] = [];

  private voxelDrag: VoxelDragState | null = null;
  private modelDrag: ModelDragState | null = null;
  private modelDragMode: 'translate' | 'rotate' = 'translate';
  private modelDragStartRotation = { x: 0, y: 0, z: 0 };
  private twoHandDrag: TwoHandDragState | null = null;

  constructor(
    private readonly coordinateMapper: CoordinateMapper,
    private readonly grid: VoxelGrid,
    private readonly voxelRenderer: VoxelRenderer,
    private readonly modelGroup: THREE.Group,
    private readonly transform: ModelTransform,
    private readonly history: HistoryManager,
    private voxelSize: number,
  ) {
    this.cursorController = new CursorController(coordinateMapper);
    this.selectionController = new SelectionController(grid, voxelRenderer);
  }

  setMode(mode: InteractionMode): void {
    this.mode = mode;
  }

  getMode(): InteractionMode {
    return this.mode;
  }

  setVoxelSize(size: number): void {
    this.voxelSize = size;
  }

  setAllowFloatingVoxels(allow: boolean): void {
    this.allowFloatingVoxels = allow;
  }

  toggleSegmentMode(): boolean {
    this.selectionController.segmentModeEnabled = !this.selectionController.segmentModeEnabled;
    if (!this.selectionController.segmentModeEnabled) this.selectionController.cancelSegmentAnchor();
    return this.selectionController.segmentModeEnabled;
  }

  deleteSelected(): void {
    const selected = this.grid.selected();
    if (selected.length === 0) return;
    this.history.execute(new RemoveVoxelsCommand(this.grid, selected.map((v) => v.id)));
  }

  clearSelection(): void {
    this.selectionController.clearSelection();
  }

  reset(): void {
    this.ownership = { ...EMPTY_OWNERSHIP };
    this.creationStartCell = null;
    this.creationCells = [];
    this.voxelDrag = null;
    this.modelDrag = null;
    this.twoHandDrag = null;
    this.voxelRenderer.clearPreview();
    this.lastSeen.clear();
    this.previousGestureType.clear();
    this.lastKnownGesture.clear();
  }

  update(stableGestures: StableGesture[], handFrames: HandFrame[], nowMs: number): InteractionFrameResult {
    const handFrameById = new Map(handFrames.map((h) => [h.handId, h]));
    const cursorByHand = new Map<string, HandCursor>();

    for (const gesture of stableGestures) {
      this.lastSeen.set(gesture.handId, nowMs);
      this.lastKnownGesture.set(gesture.handId, gesture);
      cursorByHand.set(gesture.handId, this.cursorController.computeCursor(gesture));
    }

    // Congela cursor/gesto da mão que já iniciou uma ação, caso ela saia de quadro por um instante.
    this.freezeMissingOwnerHands(nowMs, cursorByHand);

    switch (this.ownership.action) {
      case InteractionState.IDLE:
      case InteractionState.HOVERING:
      case InteractionState.SELECTING:
        this.updateIdle(stableGestures, handFrameById, cursorByHand);
        break;
      case InteractionState.CREATING_VOXELS:
        this.updateCreation(cursorByHand, nowMs);
        break;
      case InteractionState.GRABBING_VOXEL:
      case InteractionState.GRABBING_GROUP:
        this.updateVoxelGrab(cursorByHand, nowMs);
        break;
      case InteractionState.MOVING_MODEL:
        this.updateModelMove(cursorByHand, handFrameById, nowMs);
        break;
      case InteractionState.ROTATING_MODEL:
      case InteractionState.SCALING_MODEL:
        this.updateTwoHandTransform(cursorByHand, nowMs);
        break;
      default:
        break;
    }

    for (const [handId, type] of stableGestures.map((g) => [g.handId, g.type] as const)) {
      this.previousGestureType.set(handId, type);
    }

    return {
      state: this.ownership.action,
      ownership: { ...this.ownership },
      cursors: Array.from(cursorByHand.values()),
      hoveredVoxelId: this.selectionController.hoveredVoxelId,
      hintText: this.computeHint(),
    };
  }

  private freezeMissingOwnerHands(nowMs: number, cursorByHand: Map<string, HandCursor>): void {
    const owners = [this.ownership.primaryHandId, this.ownership.secondaryHandId].filter(
      (id): id is string => id !== null,
    );
    for (const handId of owners) {
      if (cursorByHand.has(handId)) continue;
      const lastSeen = this.lastSeen.get(handId);
      const lastGesture = this.lastKnownGesture.get(handId);
      if (lastSeen !== undefined && nowMs - lastSeen < HAND_LOST_GRACE_MS && lastGesture) {
        cursorByHand.set(handId, this.cursorController.computeCursor(lastGesture));
      }
    }
  }

  private isHandActive(handId: string, nowMs: number): boolean {
    const lastSeen = this.lastSeen.get(handId);
    return lastSeen !== undefined && nowMs - lastSeen < HAND_LOST_GRACE_MS;
  }

  // ---- IDLE ----

  private updateIdle(
    gestures: StableGesture[],
    handFrameById: Map<string, HandFrame>,
    cursorByHand: Map<string, HandCursor>,
  ): void {
    const pinchingHands = gestures.filter((g) => g.type === GestureType.PINCH);

    if (pinchingHands.length >= 2 && this.mode !== 'build' && this.mode !== 'edit') {
      const [a, b] = pinchingHands;
      const cursorA = cursorByHand.get(a.handId);
      const cursorB = cursorByHand.get(b.handId);
      if (cursorA && cursorB) {
        this.beginTwoHandTransform(a.handId, b.handId, cursorA.worldPos, cursorB.worldPos);
        return;
      }
    }

    const grabHand = gestures.find((g) => g.type === GestureType.GRAB);
    if (grabHand && this.mode !== 'build') {
      const handFrame = handFrameById.get(grabHand.handId);
      if (handFrame && this.isNearModel(handFrame)) {
        this.beginModelGrab(grabHand.handId, handFrame, cursorByHand.get(grabHand.handId));
        return;
      }
    }

    for (const gesture of gestures) {
      const wasPinching = this.previousGestureType.get(gesture.handId) !== GestureType.PINCH;
      if (gesture.type !== GestureType.PINCH || !wasPinching) continue;

      const cursor = cursorByHand.get(gesture.handId);
      if (!cursor) continue;

      this.handlePinchStart(gesture.handId, cursor);
      return;
    }

    let hoveredId: string | null = null;
    for (const gesture of gestures) {
      if (gesture.type !== GestureType.POINTING && gesture.type !== GestureType.PINCH) continue;
      const cursor = cursorByHand.get(gesture.handId);
      if (!cursor) continue;
      const raycaster = this.buildRaycasterToWorldPoint(cursor.worldPos);
      const hit = this.selectionController.raycastVoxel(raycaster, this.modelGroup);
      if (hit) {
        hoveredId = hit.id;
        break;
      }
    }
    this.selectionController.setHover(hoveredId);
    this.ownership = {
      action: hoveredId ? InteractionState.HOVERING : InteractionState.IDLE,
      primaryHandId: null,
      secondaryHandId: null,
    };
  }

  private handlePinchStart(handId: string, cursor: HandCursor): void {
    const raycaster = this.buildRaycasterToWorldPoint(cursor.worldPos);
    const hit = this.selectionController.raycastVoxel(raycaster, this.modelGroup);

    if (this.selectionController.segmentModeEnabled && hit) {
      this.selectionController.pickSegmentAnchor(hit.id);
      return;
    }

    if (hit && this.mode !== 'build') {
      const segmentSelection = this.grid.selected();
      const isPartOfSegment = segmentSelection.some((v) => v.id === hit.id);
      const movingVoxels = isPartOfSegment && segmentSelection.length > 1 ? segmentSelection : [hit];

      this.selectionController.selectSingle(hit.id);
      if (isPartOfSegment && segmentSelection.length > 1) this.selectionController.selectMany(segmentSelection.map((v) => v.id));

      this.voxelDrag = this.transformController.beginVoxelDrag(movingVoxels, cursor.worldPos);
      this.ownership = {
        action: movingVoxels.length > 1 ? InteractionState.GRABBING_GROUP : InteractionState.GRABBING_VOXEL,
        primaryHandId: handId,
        secondaryHandId: null,
      };
      return;
    }

    if (this.mode === 'edit') return;

    const startCell = this.coordinateMapper.worldToGrid(cursor.worldPos, this.voxelSize);
    this.creationStartCell = startCell;
    this.creationCells = [startCell];
    this.voxelRenderer.setPreview(this.creationCells, this.collidingKeys(this.creationCells));
    this.ownership = { action: InteractionState.CREATING_VOXELS, primaryHandId: handId, secondaryHandId: null };
  }

  // ---- CRIAÇÃO DE VOXELS ----

  private updateCreation(cursorByHand: Map<string, HandCursor>, nowMs: number): void {
    const handId = this.ownership.primaryHandId!;
    const cursor = cursorByHand.get(handId);
    const stillPinching =
      this.lastKnownGesture.get(handId)?.type === GestureType.PINCH && this.isHandActive(handId, nowMs);

    if (cursor && stillPinching && this.creationStartCell) {
      const currentCell = this.coordinateMapper.worldToGrid(cursor.worldPos, this.voxelSize);
      this.creationCells = computeCreationLine(this.creationStartCell, currentCell);
      this.voxelRenderer.setPreview(this.creationCells, this.collidingKeys(this.creationCells));
      return;
    }

    this.finalizeCreation();
  }

  private finalizeCreation(): void {
    const colliding = this.collidingKeys(this.creationCells);
    const specs: NewVoxelSpec[] = this.creationCells
      .filter((c) => !colliding.has(`${c.x}:${c.y}:${c.z}`))
      .map((c) => ({ coord: c, color: DEFAULT_VOXEL_COLOR }));

    if (specs.length > 0) {
      const groupId = makeGroupId();
      for (const spec of specs) spec.groupId = groupId;
      this.history.execute(new AddVoxelsCommand(this.grid, specs));
    }

    this.voxelRenderer.clearPreview();
    this.creationStartCell = null;
    this.creationCells = [];
    this.ownership = { ...EMPTY_OWNERSHIP };
  }

  private collidingKeys(cells: GridCoord[]): Set<string> {
    const result = new Set<string>();
    for (const cell of cells) {
      if (this.grid.has(cell)) result.add(`${cell.x}:${cell.y}:${cell.z}`);
    }
    return result;
  }

  // ---- SEGURAR VOXEL / GRUPO ----

  private updateVoxelGrab(cursorByHand: Map<string, HandCursor>, nowMs: number): void {
    const handId = this.ownership.primaryHandId!;
    const cursor = cursorByHand.get(handId);
    const stillPinching =
      this.lastKnownGesture.get(handId)?.type === GestureType.PINCH && this.isHandActive(handId, nowMs);

    if (!this.voxelDrag) {
      this.ownership = { ...EMPTY_OWNERSHIP };
      return;
    }

    // Promove um voxel único segurado por muito tempo para o grupo conectado inteiro.
    const gesture = this.lastKnownGesture.get(handId);
    if (
      this.ownership.action === InteractionState.GRABBING_VOXEL &&
      gesture &&
      gesture.heldForMs >= GROUP_UPGRADE_MS &&
      this.voxelDrag.targets.length === 1
    ) {
      const component = findConnectedComponent(this.grid, this.voxelDrag.targets[0].voxelId);
      if (component.length > 1 && cursor) {
        this.selectionController.selectMany(component.map((v) => v.id));
        this.voxelDrag = this.transformController.beginVoxelDrag(component, cursor.worldPos);
        this.ownership = { ...this.ownership, action: InteractionState.GRABBING_GROUP };
      }
    }

    if (cursor && stillPinching) {
      this.transformController.updateVoxelDrag(this.voxelDrag, cursor.worldPos, this.voxelSize, this.grid, this.allowFloatingVoxels);
      const preview = this.voxelDrag.targets.map((t) => t.proposedCoord);
      const colliding = this.voxelDrag.valid ? new Set<string>() : new Set(preview.map((c) => `${c.x}:${c.y}:${c.z}`));
      this.voxelRenderer.setPreview(preview, colliding);
      return;
    }

    this.finalizeVoxelDrag();
  }

  private finalizeVoxelDrag(): void {
    if (this.voxelDrag && this.voxelDrag.valid) {
      const entries: GroupMoveEntry[] = this.voxelDrag.targets.map((t) => ({
        voxelId: t.voxelId,
        from: t.originalCoord,
        to: t.proposedCoord,
      }));
      const moved = entries.some((e) => e.from.x !== e.to.x || e.from.y !== e.to.y || e.from.z !== e.to.z);
      if (moved) {
        this.history.execute(new MoveGroupCommand(this.grid, entries, entries.length > 1 ? 'Mover grupo' : 'Mover voxel'));
      }
    }

    this.voxelRenderer.clearPreview();
    this.voxelDrag = null;
    this.ownership = { ...EMPTY_OWNERSHIP };
  }

  // ---- MOVER MODELO / rotação com uma mão ----

  private isNearModel(handFrame: HandFrame): boolean {
    const voxels = this.grid.all();
    if (voxels.length === 0) return true;

    const bounds = this.voxelRenderer.computeLocalBounds(voxels);
    if (!bounds) return true;

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = (size.length() / 2) * this.transform.scale * MODEL_PROXIMITY_MARGIN + this.voxelSize * 2;

    const worldCenter = this.modelGroup.localToWorld(center.clone());
    const palmWorld = this.cursorController.computePalmWorldPos(handFrame.smoothedLandmarks);

    return palmWorld.distanceTo(worldCenter) < radius;
  }

  private beginModelGrab(handId: string, handFrame: HandFrame, cursor: HandCursor | undefined): void {
    const palmWorld = this.cursorController.computePalmWorldPos(handFrame.smoothedLandmarks);
    this.modelDragMode = this.mode === 'transform' ? 'rotate' : 'translate';

    if (this.modelDragMode === 'rotate') {
      this.modelDragStartRotation = { ...this.transform.rotation };
      if (cursor) this.lastScreenPos.set(handId, { ...cursor.screenPos });
    } else {
      this.modelDrag = this.transformController.beginModelDrag(palmWorld, this.transform);
    }

    this.ownership = { action: InteractionState.MOVING_MODEL, primaryHandId: handId, secondaryHandId: null };
  }

  private updateModelMove(
    cursorByHand: Map<string, HandCursor>,
    handFrameById: Map<string, HandFrame>,
    nowMs: number,
  ): void {
    const handId = this.ownership.primaryHandId!;
    const currentType = this.lastKnownGesture.get(handId)?.type;
    const stillGrabbing =
      this.isHandActive(handId, nowMs) &&
      (currentType === GestureType.GRAB || currentType === GestureType.CLOSED_FIST);

    if (!stillGrabbing) {
      this.finalizeModelMove();
      return;
    }

    const handFrame = handFrameById.get(handId);
    if (this.modelDragMode === 'translate' && this.modelDrag && handFrame) {
      const palmWorld = this.cursorController.computePalmWorldPos(handFrame.smoothedLandmarks);
      this.transformController.updateModelDrag(this.modelDrag, palmWorld, this.transform);
      return;
    }

    if (this.modelDragMode === 'rotate') {
      const cursor = cursorByHand.get(handId);
      const last = this.lastScreenPos.get(handId);
      if (cursor && last) {
        const dx = cursor.screenPos.x - last.x;
        const dy = cursor.screenPos.y - last.y;
        this.transformController.applySingleHandRotation(this.transform, dx, dy, SINGLE_HAND_ROTATE_SENSITIVITY);
      }
      if (cursor) this.lastScreenPos.set(handId, { ...cursor.screenPos });
    }
  }

  private finalizeModelMove(): void {
    if (this.modelDragMode === 'translate' && this.modelDrag) {
      const from = this.modelDrag.startPosition;
      const to = { ...this.transform.position };
      if (from.x !== to.x || from.y !== to.y || from.z !== to.z) {
        this.transform.position.x = from.x;
        this.transform.position.y = from.y;
        this.transform.position.z = from.z;
        this.history.execute(new MoveModelCommand(this.transform, from, to));
      }
    } else if (this.modelDragMode === 'rotate') {
      const from = this.modelDragStartRotation;
      const to = { ...this.transform.rotation };
      if (from.x !== to.x || from.y !== to.y || from.z !== to.z) {
        this.transform.rotation.x = from.x;
        this.transform.rotation.y = from.y;
        this.transform.rotation.z = from.z;
        this.history.execute(new RotateModelCommand(this.transform, from, to));
      }
    }

    this.modelDrag = null;
    this.ownership = { ...EMPTY_OWNERSHIP };
  }

  // ---- ROTAÇÃO / ESCALA COM DUAS MÃOS ----

  private beginTwoHandTransform(handA: string, handB: string, worldA: THREE.Vector3, worldB: THREE.Vector3): void {
    this.twoHandDrag = this.transformController.beginTwoHandDrag(worldA, worldB, this.transform);
    this.ownership = { action: InteractionState.SCALING_MODEL, primaryHandId: handA, secondaryHandId: handB };
  }

  private updateTwoHandTransform(cursorByHand: Map<string, HandCursor>, nowMs: number): void {
    const { primaryHandId, secondaryHandId } = this.ownership;
    if (!primaryHandId || !secondaryHandId || !this.twoHandDrag) {
      this.ownership = { ...EMPTY_OWNERSHIP };
      return;
    }

    const bothPinching =
      this.lastKnownGesture.get(primaryHandId)?.type === GestureType.PINCH &&
      this.lastKnownGesture.get(secondaryHandId)?.type === GestureType.PINCH &&
      this.isHandActive(primaryHandId, nowMs) &&
      this.isHandActive(secondaryHandId, nowMs);

    const cursorA = cursorByHand.get(primaryHandId);
    const cursorB = cursorByHand.get(secondaryHandId);

    if (bothPinching && cursorA && cursorB) {
      this.transformController.updateTwoHandDrag(this.twoHandDrag, cursorA.worldPos, cursorB.worldPos, this.transform);
      return;
    }

    this.finalizeTwoHandTransform();
  }

  private finalizeTwoHandTransform(): void {
    if (this.twoHandDrag) {
      const commands: Command[] = [];
      const fromScale = this.twoHandDrag.startScale;
      const toScale = this.transform.scale;
      const fromRotZ = this.twoHandDrag.startRotationZ;
      const toRotZ = this.transform.rotation.z;
      const fromPos = this.twoHandDrag.anchorPosition;
      const toPos = { ...this.transform.position };

      if (fromScale !== toScale) {
        this.transform.scale = fromScale;
        commands.push(new ScaleModelCommand(this.transform, fromScale, toScale));
      }
      if (fromRotZ !== toRotZ) {
        this.transform.rotation.z = fromRotZ;
        commands.push(
          new RotateModelCommand(
            this.transform,
            { x: this.transform.rotation.x, y: this.transform.rotation.y, z: fromRotZ },
            { x: this.transform.rotation.x, y: this.transform.rotation.y, z: toRotZ },
          ),
        );
      }
      if (fromPos.x !== toPos.x || fromPos.y !== toPos.y || fromPos.z !== toPos.z) {
        this.transform.position.x = fromPos.x;
        this.transform.position.y = fromPos.y;
        this.transform.position.z = fromPos.z;
        commands.push(new MoveModelCommand(this.transform, fromPos, toPos));
      }

      if (commands.length > 0) {
        this.history.execute(new CompositeCommand(commands, 'Rotacionar/redimensionar modelo'));
      }
    }

    this.twoHandDrag = null;
    this.ownership = { ...EMPTY_OWNERSHIP };
  }

  // ---- auxiliares ----

  private buildRaycasterToWorldPoint(worldPos: THREE.Vector3): THREE.Raycaster {
    const cameraPosition = this.coordinateMapper.getCameraWorldPosition();
    const direction = worldPos.clone().sub(cameraPosition).normalize();
    return new THREE.Raycaster(cameraPosition, direction);
  }

  private computeHint(): string {
    switch (this.ownership.action) {
      case InteractionState.CREATING_VOXELS:
        return 'Criando blocos — solte a pinça para confirmar';
      case InteractionState.GRABBING_VOXEL:
        return 'Movendo cubo — segure para agrupar (500ms)';
      case InteractionState.GRABBING_GROUP:
        return 'Movendo grupo conectado';
      case InteractionState.MOVING_MODEL:
        return this.modelDragMode === 'rotate' ? 'Rotacionando modelo' : 'Movendo estrutura completa';
      case InteractionState.SCALING_MODEL:
      case InteractionState.ROTATING_MODEL:
        return 'Rotacionando e redimensionando com duas mãos';
      case InteractionState.HOVERING:
        return 'Cubo em foco — faça uma pinça para selecionar';
      default:
        return 'Pinça para criar • Punho para mover tudo • Duas pinças para girar/escalar';
    }
  }
}
