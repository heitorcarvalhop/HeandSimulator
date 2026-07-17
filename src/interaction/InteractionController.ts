import * as THREE from 'three';
import { GestureType, type HandFrame } from '../hand-tracking/HandTypes';
import type { StableGesture } from '../hand-tracking/GestureStateMachine';
import type { CoordinateMapper } from '../rendering/CoordinateMapper';
import { findConnectedComponent } from '../voxels/ConnectedComponents';
import { computeCreationLine } from '../voxels/VoxelBuilder';
import { DEFAULT_VOXEL_COLOR, makeGroupId, type FreeTransform, type GridCoord } from '../voxels/Voxel';
import { worldToLocalGrid, worldToLocalPoint } from './WorldGridMapping';
import { snapToNearestCubeRotation, rotateGridOffset } from './PieceRotationSnap';
import type { VoxelGrid } from '../voxels/VoxelGrid';
import type { VoxelRenderer } from '../voxels/VoxelRenderer';
import type { ModelTransform, PieceReleaseMode } from '../voxels/VoxelSerializer';
import { HistoryManager } from '../history/HistoryManager';
import type { Command } from '../history/Command';
import {
  AddVoxelsCommand,
  CompositeCommand,
  MoveGroupCommand,
  RemoveVoxelsCommand,
  RotateModelCommand,
  ScaleModelCommand,
  MoveModelCommand,
  SetFreeTransformCommand,
  type GroupMoveEntry,
  type NewVoxelSpec,
} from '../history/VoxelCommands';
import { CursorController, type HandCursor } from './CursorController';
import { SelectionController } from './SelectionController';
import {
  TransformController,
  type ModelDragState,
  type PieceDragState,
  type PieceDragTarget,
  type SwitchHandTransformState,
  type TwoHandDragState,
  type VoxelDragState,
} from './TransformController';
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
  private pieceReleaseMode: PieceReleaseMode = 'snap';

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
  private switchHandTransform: SwitchHandTransformState | null = null;
  private pieceDrag: PieceDragState | null = null;
  private pieceGrabGroupId: string | null = null;
  private pieceGrabPreviousFreeTransform: FreeTransform | null = null;

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

  setPieceReleaseMode(mode: PieceReleaseMode): void {
    this.pieceReleaseMode = mode;
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
    this.switchHandTransform = null;
    this.pieceDrag = null;
    this.pieceGrabGroupId = null;
    this.pieceGrabPreviousFreeTransform = null;
    this.voxelRenderer.clearPreview();
    this.voxelRenderer.setHeldPiece(null);
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
      case InteractionState.GRABBING_PIECE:
        this.updateGrabbingPiece(cursorByHand, handFrameById, nowMs);
        break;
      case InteractionState.MOVING_MODEL:
        this.updateModelMove(cursorByHand, handFrameById, nowMs);
        break;
      case InteractionState.ROTATING_MODEL:
        this.updateSwitchHandTransform(handFrameById, nowMs);
        break;
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
    const orientPair = this.findFistAndOpenPalmPair(gestures);
    if (orientPair && this.mode !== 'build') {
      const openFrame = handFrameById.get(orientPair.openId);
      if (openFrame) {
        this.beginSwitchHandTransform(orientPair.fistId, orientPair.openId, openFrame);
        return;
      }
    }

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

    // Uma mão fechada (punho) só agarra o modelo inteiro se a outra mão não estiver pinçando —
    // punho + pinça significa "segure a peça com a pinça", não "mova tudo com o punho".
    const grabHand = gestures.find((g) => g.type === GestureType.GRAB);
    if (grabHand && this.mode !== 'build' && pinchingHands.length === 0) {
      const handFrame = handFrameById.get(grabHand.handId);
      if (handFrame && this.isNearModel(handFrame)) {
        this.beginModelGrab(grabHand.handId, handFrame, cursorByHand.get(grabHand.handId));
        return;
      }
    }

    // Punho fechado + pinça na outra mão: se a pinça mirar um voxel, agarra a peça inteira
    // (componente conectado) com posição/orientação livres, como se segurasse de verdade.
    // Sem acerto, cai pro fluxo normal de criação no loop abaixo.
    if (grabHand && pinchingHands.length === 1 && this.mode !== 'build' && !this.selectionController.segmentModeEnabled) {
      const pinchGesture = pinchingHands[0];
      const justStartedPinching = this.previousGestureType.get(pinchGesture.handId) !== GestureType.PINCH;
      const pinchFrame = handFrameById.get(pinchGesture.handId);
      const cursor = cursorByHand.get(pinchGesture.handId);

      if (justStartedPinching && pinchFrame && cursor) {
        const raycaster = this.buildRaycasterToWorldPoint(cursor.worldPos);
        const hit = this.selectionController.raycastVoxel(raycaster, this.modelGroup);
        if (hit) {
          this.beginPieceGrab(pinchGesture.handId, grabHand.handId, hit.id, cursor, pinchFrame);
          return;
        }
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

      this.voxelDrag = this.transformController.beginVoxelDrag(movingVoxels, worldToLocalPoint(this.modelGroup, cursor.worldPos));
      this.ownership = {
        action: movingVoxels.length > 1 ? InteractionState.GRABBING_GROUP : InteractionState.GRABBING_VOXEL,
        primaryHandId: handId,
        secondaryHandId: null,
      };
      return;
    }

    if (this.mode === 'edit') return;

    // A ponta da pinça define exatamente onde o bloco nasce — precisa estar no espaço local
    // do modelo, senão criar depois de mover/girar/escalar a peça desalinha do dedo.
    const startCell = worldToLocalGrid(this.modelGroup, cursor.worldPos, this.voxelSize);
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
      const currentCell = worldToLocalGrid(this.modelGroup, cursor.worldPos, this.voxelSize);
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
        this.voxelDrag = this.transformController.beginVoxelDrag(component, worldToLocalPoint(this.modelGroup, cursor.worldPos));
        this.ownership = { ...this.ownership, action: InteractionState.GRABBING_GROUP };
      }
    }

    if (cursor && stillPinching) {
      const localCursor = worldToLocalPoint(this.modelGroup, cursor.worldPos);
      this.transformController.updateVoxelDrag(this.voxelDrag, localCursor, this.voxelSize, this.grid, this.allowFloatingVoxels);
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

  // ---- SEGURAR PEÇA PELA PONTA (punho fechado + pinça, posição/orientação livres) ----

  private beginPieceGrab(
    pinchHandId: string,
    fistHandId: string,
    anchorVoxelId: string,
    cursor: HandCursor,
    pinchFrame: HandFrame,
  ): void {
    const anchorVoxel = this.grid.get(anchorVoxelId);
    if (!anchorVoxel) return;

    const component = findConnectedComponent(this.grid, anchorVoxelId);
    const anchorCell: GridCoord = { x: anchorVoxel.gridX, y: anchorVoxel.gridY, z: anchorVoxel.gridZ };
    const anchorBaseLocal = new THREE.Vector3(anchorCell.x * this.voxelSize, anchorCell.y * this.voxelSize, anchorCell.z * this.voxelSize);
    const modelQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.transform.rotation.x, this.transform.rotation.y, this.transform.rotation.z, 'XYZ'),
    );

    // Se a peça já estava solta no modo livre, retoma a pose atual dela em vez de saltar pra grade.
    const previousFreeTransform = this.grid.getFreeTransform(anchorVoxel.groupId) ?? null;
    let anchorStartWorld: THREE.Vector3;
    let startQuaternion: THREE.Quaternion;

    if (previousFreeTransform) {
      this.grid.clearFreeTransform(anchorVoxel.groupId);
      const anchorLocal = anchorBaseLocal.clone().add(
        new THREE.Vector3(previousFreeTransform.offset.x, previousFreeTransform.offset.y, previousFreeTransform.offset.z),
      );
      anchorStartWorld = this.modelGroup.localToWorld(anchorLocal);
      const localQuat = new THREE.Quaternion(
        previousFreeTransform.quaternion.x,
        previousFreeTransform.quaternion.y,
        previousFreeTransform.quaternion.z,
        previousFreeTransform.quaternion.w,
      );
      startQuaternion = modelQuat.clone().multiply(localQuat);
    } else {
      anchorStartWorld = this.modelGroup.localToWorld(anchorBaseLocal.clone());
      startQuaternion = new THREE.Quaternion();
    }

    const groupId = makeGroupId();
    for (const voxel of component) this.grid.setGroup(voxel.id, groupId);
    this.selectionController.selectMany(component.map((v) => v.id));

    const targets: PieceDragTarget[] = component.map((v) => ({
      voxelId: v.id,
      localOffset: { x: v.gridX - anchorCell.x, y: v.gridY - anchorCell.y, z: v.gridZ - anchorCell.z },
    }));

    const pinchQuat = this.cursorController.computePalmOrientation(pinchFrame.smoothedLandmarks);
    this.pieceDrag = this.transformController.beginPieceGrab(targets, anchorCell, anchorStartWorld, startQuaternion, cursor.worldPos, pinchQuat);
    this.pieceGrabGroupId = groupId;
    this.pieceGrabPreviousFreeTransform = previousFreeTransform;

    const heldEntries = component.map((v) => {
      const target = targets.find((t) => t.voxelId === v.id)!;
      return { id: v.id, localOffset: target.localOffset, color: v.color };
    });
    this.voxelRenderer.setHeldPiece(heldEntries);
    this.voxelRenderer.updateHeldPieceTransform(this.pieceDrag.liveWorldPosition, this.pieceDrag.liveQuaternion);

    this.ownership = { action: InteractionState.GRABBING_PIECE, primaryHandId: pinchHandId, secondaryHandId: fistHandId };
  }

  private updateGrabbingPiece(
    cursorByHand: Map<string, HandCursor>,
    handFrameById: Map<string, HandFrame>,
    nowMs: number,
  ): void {
    const { primaryHandId: pinchHandId, secondaryHandId: fistHandId } = this.ownership;
    if (!pinchHandId || !fistHandId || !this.pieceDrag) {
      this.cancelPieceGrab();
      return;
    }

    // Mão perdida de vista (fora da janela de graça) cancela sem gravar nada — arraste é só
    // prévia até soltar. Gesto que mudou com a mão ainda rastreada é que confirma (solta a peça).
    if (!this.isHandActive(pinchHandId, nowMs) || !this.isHandActive(fistHandId, nowMs)) {
      this.cancelPieceGrab();
      return;
    }

    const pinchType = this.lastKnownGesture.get(pinchHandId)?.type;
    const fistType = this.lastKnownGesture.get(fistHandId)?.type;
    const stillActive =
      pinchType === GestureType.PINCH && (fistType === GestureType.GRAB || fistType === GestureType.CLOSED_FIST);

    if (!stillActive) {
      this.finalizePieceGrab();
      return;
    }

    const cursor = cursorByHand.get(pinchHandId);
    const pinchFrame = handFrameById.get(pinchHandId);
    if (cursor && pinchFrame) {
      const pinchQuat = this.cursorController.computePalmOrientation(pinchFrame.smoothedLandmarks);
      this.transformController.updatePieceGrab(this.pieceDrag, cursor.worldPos, pinchQuat);
      this.voxelRenderer.updateHeldPieceTransform(this.pieceDrag.liveWorldPosition, this.pieceDrag.liveQuaternion);
      this.updatePieceSnapPreview();
    }
    // Frame bruto momentaneamente ausente mas mão ainda "ativa" (dentro da graça): não atualiza
    // este frame, mesma tolerância que updateModelMove já usa.
  }

  /** Prévia do destino (modo de encaixe 90°): onde a peça encaixaria se fosse solta agora. */
  private updatePieceSnapPreview(): void {
    if (!this.pieceDrag) return;

    if (this.pieceReleaseMode !== 'snap') {
      this.voxelRenderer.clearPreview();
      return;
    }

    const snappedRotation = snapToNearestCubeRotation(this.pieceDrag.liveQuaternion);
    const newAnchorCell = worldToLocalGrid(this.modelGroup, this.pieceDrag.liveWorldPosition, this.voxelSize);
    const movingIds = new Set(this.pieceDrag.targets.map((t) => t.voxelId));

    const proposedCells: GridCoord[] = [];
    const validationTargets = this.pieceDrag.targets.map((t) => {
      const rotatedOffset = rotateGridOffset(t.localOffset, snappedRotation);
      const proposedCoord: GridCoord = {
        x: newAnchorCell.x + rotatedOffset.x,
        y: newAnchorCell.y + rotatedOffset.y,
        z: newAnchorCell.z + rotatedOffset.z,
      };
      proposedCells.push(proposedCoord);
      return { voxelId: t.voxelId, originalCoord: proposedCoord, proposedCoord };
    });

    const valid = this.transformController.validateDrag({ targets: validationTargets }, this.grid, movingIds, this.allowFloatingVoxels);
    const collidingKeys = valid ? new Set<string>() : new Set(proposedCells.map((c) => `${c.x}:${c.y}:${c.z}`));
    this.voxelRenderer.setPreview(proposedCells, collidingKeys);
  }

  private cancelPieceGrab(): void {
    if (this.pieceGrabGroupId && this.pieceGrabPreviousFreeTransform) {
      this.grid.setFreeTransform(this.pieceGrabGroupId, this.pieceGrabPreviousFreeTransform);
    }
    this.voxelRenderer.setHeldPiece(null);
    this.voxelRenderer.clearPreview();
    this.pieceDrag = null;
    this.pieceGrabGroupId = null;
    this.pieceGrabPreviousFreeTransform = null;
    this.ownership = { ...EMPTY_OWNERSHIP };
  }

  private finalizePieceGrab(): void {
    const drag = this.pieceDrag;
    const groupId = this.pieceGrabGroupId;
    this.voxelRenderer.setHeldPiece(null);
    this.voxelRenderer.clearPreview();

    if (drag && groupId) {
      if (this.pieceReleaseMode === 'free') {
        this.commitPieceGrabFree(drag, groupId);
      } else {
        this.commitPieceGrabSnap(drag);
      }
    }

    this.pieceDrag = null;
    this.pieceGrabGroupId = null;
    this.pieceGrabPreviousFreeTransform = null;
    this.ownership = { ...EMPTY_OWNERSHIP };
  }

  /** Modo "encaixe 90°": arredonda a rotação pro múltiplo de 90° mais próximo e vira coordenadas de grade inteiras. */
  private commitPieceGrabSnap(drag: PieceDragState): void {
    const snappedRotation = snapToNearestCubeRotation(drag.liveQuaternion);
    const newAnchorCell = worldToLocalGrid(this.modelGroup, drag.liveWorldPosition, this.voxelSize);
    const movingIds = new Set(drag.targets.map((t) => t.voxelId));

    const proposedTargets = drag.targets.map((t) => {
      const currentVoxel = this.grid.get(t.voxelId);
      const originalCoord: GridCoord = currentVoxel
        ? { x: currentVoxel.gridX, y: currentVoxel.gridY, z: currentVoxel.gridZ }
        : { x: 0, y: 0, z: 0 };
      const rotatedOffset = rotateGridOffset(t.localOffset, snappedRotation);
      const proposedCoord: GridCoord = {
        x: newAnchorCell.x + rotatedOffset.x,
        y: newAnchorCell.y + rotatedOffset.y,
        z: newAnchorCell.z + rotatedOffset.z,
      };
      return { voxelId: t.voxelId, originalCoord, proposedCoord };
    });

    const valid = this.transformController.validateDrag({ targets: proposedTargets }, this.grid, movingIds, this.allowFloatingVoxels);
    if (!valid) return; // colisão: cancela — a peça nunca saiu da célula original, nada pra desfazer.

    const entries: GroupMoveEntry[] = proposedTargets.map((t) => ({ voxelId: t.voxelId, from: t.originalCoord, to: t.proposedCoord }));
    const moved = entries.some((e) => e.from.x !== e.to.x || e.from.y !== e.to.y || e.from.z !== e.to.z);
    if (moved) {
      this.history.execute(new MoveGroupCommand(this.grid, entries, entries.length > 1 ? 'Girar/mover peça' : 'Mover peça'));
    }
  }

  /** Modo "encaixe livre": guarda a orientação/posição contínua exata em que a peça foi solta. */
  private commitPieceGrabFree(drag: PieceDragState, groupId: string): void {
    const modelQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.transform.rotation.x, this.transform.rotation.y, this.transform.rotation.z, 'XYZ'),
    );
    const anchorBaseLocal = new THREE.Vector3(
      drag.anchorOriginalCell.x * this.voxelSize,
      drag.anchorOriginalCell.y * this.voxelSize,
      drag.anchorOriginalCell.z * this.voxelSize,
    );
    const liveLocalPosition = worldToLocalPoint(this.modelGroup, drag.liveWorldPosition);
    const localOffset = liveLocalPosition.clone().sub(anchorBaseLocal);
    const localQuat = modelQuat.clone().invert().multiply(drag.liveQuaternion);

    const next: FreeTransform = {
      anchorCell: { ...drag.anchorOriginalCell },
      offset: { x: localOffset.x, y: localOffset.y, z: localOffset.z },
      quaternion: { x: localQuat.x, y: localQuat.y, z: localQuat.z, w: localQuat.w },
    };

    this.history.execute(new SetFreeTransformCommand(this.grid, groupId, this.pieceGrabPreviousFreeTransform, next));
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

  // ---- MÃO ABERTA CONTROLA A PEÇA, PUNHO É SÓ A CHAVE LIGA/DESLIGA ----

  private findFistAndOpenPalmPair(gestures: StableGesture[]): { fistId: string; openId: string } | null {
    const fist = gestures.find((g) => g.type === GestureType.GRAB);
    const open = gestures.find((g) => g.type === GestureType.OPEN_PALM);
    if (!fist || !open || fist.handId === open.handId) return null;
    return { fistId: fist.handId, openId: open.handId };
  }

  private beginSwitchHandTransform(fistId: string, openId: string, openFrame: HandFrame): void {
    const openWorld = this.cursorController.computePalmWorldPos(openFrame.smoothedLandmarks);
    const openQuat = this.cursorController.computePalmOrientation(openFrame.smoothedLandmarks);
    this.switchHandTransform = this.transformController.beginSwitchHandTransform(openWorld, openQuat, this.transform);
    this.ownership = { action: InteractionState.ROTATING_MODEL, primaryHandId: fistId, secondaryHandId: openId };
  }

  private updateSwitchHandTransform(handFrameById: Map<string, HandFrame>, nowMs: number): void {
    const { primaryHandId, secondaryHandId } = this.ownership;
    if (!primaryHandId || !secondaryHandId || !this.switchHandTransform) {
      this.ownership = { ...EMPTY_OWNERSHIP };
      return;
    }

    // O punho (primaryHandId) só precisa continuar fechado e visível — ele é a chave.
    // A mão aberta (secondaryHandId) controla a peça, não importa o gesto que ela esteja fazendo.
    const fistType = this.lastKnownGesture.get(primaryHandId)?.type;
    const stillActive =
      (fistType === GestureType.GRAB || fistType === GestureType.CLOSED_FIST) &&
      this.isHandActive(primaryHandId, nowMs) &&
      this.isHandActive(secondaryHandId, nowMs);

    const openFrame = handFrameById.get(secondaryHandId);

    if (stillActive && openFrame) {
      const openWorld = this.cursorController.computePalmWorldPos(openFrame.smoothedLandmarks);
      const openQuat = this.cursorController.computePalmOrientation(openFrame.smoothedLandmarks);
      this.transformController.updateSwitchHandTransform(this.switchHandTransform, openWorld, openQuat, this.transform);
      return;
    }

    this.finalizeSwitchHandTransform();
  }

  private finalizeSwitchHandTransform(): void {
    if (this.switchHandTransform) {
      const commands: Command[] = [];
      const fromRot = this.switchHandTransform.startRotation;
      const toRot = { ...this.transform.rotation };
      const fromPos = this.switchHandTransform.startPosition;
      const toPos = { ...this.transform.position };

      if (fromRot.x !== toRot.x || fromRot.y !== toRot.y || fromRot.z !== toRot.z) {
        this.transform.rotation.x = fromRot.x;
        this.transform.rotation.y = fromRot.y;
        this.transform.rotation.z = fromRot.z;
        commands.push(new RotateModelCommand(this.transform, fromRot, toRot));
      }
      if (fromPos.x !== toPos.x || fromPos.y !== toPos.y || fromPos.z !== toPos.z) {
        this.transform.position.x = fromPos.x;
        this.transform.position.y = fromPos.y;
        this.transform.position.z = fromPos.z;
        commands.push(new MoveModelCommand(this.transform, fromPos, toPos));
      }

      if (commands.length > 0) {
        this.history.execute(new CompositeCommand(commands, 'Girar e mover modelo'));
      }
    }

    this.switchHandTransform = null;
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
      case InteractionState.GRABBING_PIECE:
        return this.pieceReleaseMode === 'free'
          ? 'Segurando a peça — solte para deixar no ângulo exato'
          : 'Segurando a peça — solte para encaixar no grid mais próximo (90°)';
      case InteractionState.MOVING_MODEL:
        return this.modelDragMode === 'rotate' ? 'Rotacionando modelo' : 'Movendo estrutura completa';
      case InteractionState.SCALING_MODEL:
        return 'Rotacionando e redimensionando com duas mãos';
      case InteractionState.ROTATING_MODEL:
        return 'Mão aberta controla a peça — punho fechado mantém o comando ativo';
      case InteractionState.HOVERING:
        return 'Cubo em foco — faça uma pinça para selecionar';
      default:
        return 'Pinça para criar • Punho para mover tudo • Duas pinças para escalar/girar • Punho fechado + mão aberta: move e gira o modelo inteiro • Punho fechado + pinça: segura e gira só a peça pinçada';
    }
  }
}
