import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CoordinateMapper } from '../rendering/CoordinateMapper';
import { VoxelGrid } from '../voxels/VoxelGrid';
import { VoxelRenderer } from '../voxels/VoxelRenderer';
import { HistoryManager } from '../history/HistoryManager';
import { InteractionController } from '../interaction/InteractionController';
import { InteractionState } from '../interaction/InteractionTypes';
import { GestureType, type GestureResult, type HandFrame, type Landmark } from '../hand-tracking/HandTypes';
import { GestureStateMachine } from '../hand-tracking/GestureStateMachine';
import { pinchLandmarks } from './fixtures/handPoses';
import type { ModelTransform } from '../voxels/VoxelSerializer';

function setupController() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const coordinateMapper = new CoordinateMapper(camera);
  coordinateMapper.updateViewportSize(1000, 1000);
  coordinateMapper.updateVideoSize(1000, 1000);

  const grid = new VoxelGrid();
  const voxelRenderer = new VoxelRenderer(0.6);
  const modelGroup = new THREE.Group();
  modelGroup.updateMatrixWorld();
  const transform: ModelTransform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 };
  const history = new HistoryManager();

  const controller = new InteractionController(coordinateMapper, grid, voxelRenderer, modelGroup, transform, history, 0.6);

  return { controller, grid, history, voxelRenderer, modelGroup };
}

function pinchGestureResult(handId: string, midpoint: Landmark): GestureResult {
  return {
    type: GestureType.PINCH,
    intensity: 1,
    pinchStrength: 1,
    isPinching: true,
    pinchMidpoint: midpoint,
    isPointing: false,
    pointingTip: null,
    isFist: false,
    isOpenPalm: false,
    palmSize: 0.2,
    handId,
    handedness: 'Right',
  };
}

function openPalmGestureResult(handId: string): GestureResult {
  return {
    type: GestureType.OPEN_PALM,
    intensity: 1,
    pinchStrength: 0,
    isPinching: false,
    pinchMidpoint: null,
    isPointing: false,
    pointingTip: null,
    isFist: false,
    isOpenPalm: true,
    palmSize: 0.2,
    handId,
    handedness: 'Right',
  };
}

function makeHandFrame(handId: string): HandFrame {
  const landmarks = pinchLandmarks();
  return {
    handId,
    handedness: 'Right',
    confidence: 0.9,
    rawLandmarks: landmarks,
    landmarks,
    smoothedLandmarks: landmarks,
    timestampMs: 0,
  };
}

function closedFistGestureResult(handId: string): GestureResult {
  return {
    type: GestureType.CLOSED_FIST,
    intensity: 1,
    pinchStrength: 0,
    isPinching: false,
    pinchMidpoint: null,
    isPointing: false,
    pointingTip: null,
    isFist: true,
    isOpenPalm: false,
    palmSize: 0.2,
    handId,
    handedness: 'Left',
  };
}

/** Mão sintética: só o punho e o MCP médio importam para o calculo da posição de mundo da palma. */
function makeHandFrameAt(handId: string, point: Landmark): HandFrame {
  const landmarks = new Array(21).fill(point) as Landmark[];
  return {
    handId,
    handedness: 'Left',
    confidence: 0.9,
    rawLandmarks: landmarks,
    landmarks,
    smoothedLandmarks: landmarks,
    timestampMs: 0,
  };
}

describe('InteractionController creation flow (real gesture -> real voxels)', () => {
  it('creates a line of voxels by holding a pinch in empty space and dragging, then releases on open palm', () => {
    const { controller, grid, history } = setupController();
    const stateMachine = new GestureStateMachine();
    const handId = 'right';
    const hands = [makeHandFrame(handId)];

    // Frame 1: pinça inicia no centro do viewport/mundo.
    let stable = stateMachine.update([pinchGestureResult(handId, { x: 0.5, y: 0.5, z: 0 })], 0);
    let frame = controller.update(stable, hands, 0);
    expect(frame.state).toBe(InteractionState.CREATING_VOXELS);
    expect(grid.size).toBe(0); // still just a preview, nothing committed yet

    // Frame 2: ainda pinçando, cursor arrasta para a direita -> extrude uma linha em X.
    stable = stateMachine.update([pinchGestureResult(handId, { x: 0.65, y: 0.5, z: 0 })], 50);
    frame = controller.update(stable, hands, 50);
    expect(frame.state).toBe(InteractionState.CREATING_VOXELS);
    expect(grid.size).toBe(0);

    // Frame 3: mão abre -> pinça solta -> a linha arrastada é confirmada como voxels reais.
    stable = stateMachine.update([openPalmGestureResult(handId)], 100);
    frame = controller.update(stable, hands, 100);
    expect(frame.state).toBe(InteractionState.IDLE);
    expect(grid.size).toBeGreaterThan(1);
    expect(history.canUndo).toBe(true);
  });

  it('undo removes exactly what a completed creation gesture added', () => {
    const { controller, grid, history } = setupController();
    const stateMachine = new GestureStateMachine();
    const handId = 'right';
    const hands = [makeHandFrame(handId)];

    let stable = stateMachine.update([pinchGestureResult(handId, { x: 0.5, y: 0.5, z: 0 })], 0);
    controller.update(stable, hands, 0);
    stable = stateMachine.update([openPalmGestureResult(handId)], 50);
    controller.update(stable, hands, 50);

    const countAfterCreate = grid.size;
    expect(countAfterCreate).toBeGreaterThan(0);

    history.undo();
    expect(grid.size).toBe(0);
    history.redo();
    expect(grid.size).toBe(countAfterCreate);
  });

  it('grabbing an existing voxel and moving it commits the new position on release', () => {
    const { controller, grid, voxelRenderer } = setupController();
    grid.add({ x: 0, y: 0, z: 0 });
    voxelRenderer.update(grid.all(), grid.version); // populate the InstancedMesh so raycasting can hit it
    const stateMachine = new GestureStateMachine();
    const handId = 'right';
    const hands = [makeHandFrame(handId)];

    // Pinça exatamente na posição do voxel existente (centro da grade -> origem do mundo).
    let stable = stateMachine.update([pinchGestureResult(handId, { x: 0.5, y: 0.5, z: 0 })], 0);
    let frame = controller.update(stable, hands, 0);
    expect(frame.state).toBe(InteractionState.GRABBING_VOXEL);

    stable = stateMachine.update([openPalmGestureResult(handId)], 50);
    frame = controller.update(stable, hands, 50);
    expect(frame.state).toBe(InteractionState.IDLE);
    expect(grid.size).toBe(1);
  });
});

describe('InteractionController two-hand orient (fist + open palm)', () => {
  it('enters ROTATING_MODEL once the fist hand is held long enough while the other hand is open, then commits the move+rotate to history on release', () => {
    const { controller, history } = setupController();
    const stateMachine = new GestureStateMachine();
    const fistId = 'left';
    const openId = 'right';

    const fistAt = (x: number) => makeHandFrameAt(fistId, { x, y: 0, z: 0 });
    const openAt = (x: number) => makeHandFrameAt(openId, { x, y: 0, z: 0 });

    // Segura o punho por tempo suficiente (>180ms) para virar GRAB, com a outra mão já aberta.
    stateMachine.update([closedFistGestureResult(fistId), openPalmGestureResult(openId)], 0);
    let stable = stateMachine.update(
      [closedFistGestureResult(fistId), openPalmGestureResult(openId)],
      300,
    );
    let frame = controller.update(stable, [fistAt(-1), openAt(1)], 300);
    expect(frame.state).toBe(InteractionState.ROTATING_MODEL);

    // Move as duas mãos juntas para a direita -> o modelo deve acompanhar a translação.
    stable = stateMachine.update([closedFistGestureResult(fistId), openPalmGestureResult(openId)], 350);
    frame = controller.update(stable, [fistAt(0), openAt(2)], 350);
    expect(frame.state).toBe(InteractionState.ROTATING_MODEL);

    // Abre a mão do punho -> solta o gesto, e a mudança de posição vira um comando no histórico.
    stable = stateMachine.update([openPalmGestureResult(fistId), openPalmGestureResult(openId)], 400);
    frame = controller.update(stable, [fistAt(0), openAt(2)], 400);
    expect(frame.state).toBe(InteractionState.IDLE);
    expect(history.canUndo).toBe(true);
  });
});

describe('InteractionController creation respects the model transform', () => {
  it('creates the voxel at the local grid cell under the pinch tip, not at the raw world cell', () => {
    const { controller, grid, modelGroup } = setupController();
    // Modelo deslocado do mundo (ex.: já foi movido antes) — a pinça continua mirando o
    // centro do mundo (0,0,0), mas isso deve virar uma célula local diferente de (0,0,0).
    modelGroup.position.set(3, 0, 0);
    modelGroup.updateMatrixWorld();

    const stateMachine = new GestureStateMachine();
    const handId = 'right';
    const hands = [makeHandFrame(handId)];

    let stable = stateMachine.update([pinchGestureResult(handId, { x: 0.5, y: 0.5, z: 0 })], 0);
    controller.update(stable, hands, 0);
    stable = stateMachine.update([openPalmGestureResult(handId)], 50);
    controller.update(stable, hands, 50);

    expect(grid.size).toBe(1);
    const voxel = grid.all()[0];
    // world(0,0,0) no espaço local do grupo deslocado em +3 no X -> -3 -> -5 células de 0.6.
    expect(voxel.gridX).toBe(-5);
    expect(voxel.gridY).toBe(0);
    expect(voxel.gridZ).toBe(0);
  });
});

describe('InteractionController two-hand: punho fechado + pinça agarra a peça, não o modelo inteiro', () => {
  it('lets the pinching hand grab the piece (free position/orientation) instead of the fist hijacking a whole-model move', () => {
    const { controller, grid, voxelRenderer } = setupController();
    grid.add({ x: 0, y: 0, z: 0 });
    voxelRenderer.update(grid.all(), grid.version); // popula o InstancedMesh pra o raycast acertar

    const stateMachine = new GestureStateMachine();
    const fistId = 'left';
    const pinchId = 'right';
    const fistFrame = makeHandFrameAt(fistId, { x: 0.5, y: 0.5, z: 0 });
    const pinchFrame = makeHandFrame(pinchId);

    // Segura o punho tempo suficiente (>180ms) pra virar GRAB antes da outra mão pinçar.
    stateMachine.update([closedFistGestureResult(fistId)], 0);
    const stable = stateMachine.update(
      [closedFistGestureResult(fistId), pinchGestureResult(pinchId, { x: 0.5, y: 0.5, z: 0 })],
      300,
    );
    const frame = controller.update(stable, [fistFrame, pinchFrame], 300);

    expect(frame.state).toBe(InteractionState.GRABBING_PIECE);
    expect(frame.ownership.primaryHandId).toBe(pinchId);
    expect(frame.ownership.secondaryHandId).toBe(fistId);
  });

  it('moves the whole connected piece together and leaves a disconnected neighbor untouched (snap mode)', () => {
    const { controller, grid, voxelRenderer, history } = setupController();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    const b = grid.add({ x: 1, y: 0, z: 0 })!; // conectado a "a"
    const c = grid.add({ x: 3, y: 0, z: 0 })!; // solto, sem contato
    voxelRenderer.update(grid.all(), grid.version);

    const stateMachine = new GestureStateMachine();
    const fistId = 'left';
    const pinchId = 'right';
    const fistFrame = makeHandFrameAt(fistId, { x: 0.5, y: 0.5, z: 0 });
    const pinchFrame = makeHandFrame(pinchId);

    stateMachine.update([closedFistGestureResult(fistId)], 0);
    let stable = stateMachine.update(
      [closedFistGestureResult(fistId), pinchGestureResult(pinchId, { x: 0.5, y: 0.5, z: 0 })],
      300,
    );
    let frame = controller.update(stable, [fistFrame, pinchFrame], 300);
    expect(frame.state).toBe(InteractionState.GRABBING_PIECE);

    // Arrasta a pinça (punho continua fechado) -> a peça segue a mão livremente.
    stable = stateMachine.update(
      [closedFistGestureResult(fistId), pinchGestureResult(pinchId, { x: 0.65, y: 0.5, z: 0 })],
      350,
    );
    frame = controller.update(stable, [fistFrame, pinchFrame], 350);
    expect(frame.state).toBe(InteractionState.GRABBING_PIECE);

    // Abre a pinça -> confirma no modo de encaixe padrão (90°/grid).
    stable = stateMachine.update([closedFistGestureResult(fistId), openPalmGestureResult(pinchId)], 400);
    frame = controller.update(stable, [fistFrame, pinchFrame], 400);
    expect(frame.state).toBe(InteractionState.IDLE);

    const voxelA = grid.get(a.id)!;
    const voxelB = grid.get(b.id)!;
    const deltaA = { x: voxelA.gridX - 0, y: voxelA.gridY - 0, z: voxelA.gridZ - 0 };
    const deltaB = { x: voxelB.gridX - 1, y: voxelB.gridY - 0, z: voxelB.gridZ - 0 };

    expect(deltaA).toEqual(deltaB); // moveram juntos, pelo mesmo delta
    expect(deltaA).not.toEqual({ x: 0, y: 0, z: 0 }); // realmente moveu
    expect(grid.get(c.id)).toMatchObject({ gridX: 3, gridY: 0, gridZ: 0 }); // desconectado ficou parado
    expect(history.canUndo).toBe(true);
  });

  it('commits a continuous free transform (grid coordinates untouched) when release mode is "free"', () => {
    const { controller, grid, voxelRenderer, history } = setupController();
    controller.setPieceReleaseMode('free');
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    voxelRenderer.update(grid.all(), grid.version);

    const stateMachine = new GestureStateMachine();
    const fistId = 'left';
    const pinchId = 'right';
    const fistFrame = makeHandFrameAt(fistId, { x: 0.5, y: 0.5, z: 0 });
    const pinchFrame = makeHandFrame(pinchId);

    stateMachine.update([closedFistGestureResult(fistId)], 0);
    let stable = stateMachine.update(
      [closedFistGestureResult(fistId), pinchGestureResult(pinchId, { x: 0.5, y: 0.5, z: 0 })],
      300,
    );
    let frame = controller.update(stable, [fistFrame, pinchFrame], 300);
    expect(frame.state).toBe(InteractionState.GRABBING_PIECE);

    stable = stateMachine.update(
      [closedFistGestureResult(fistId), pinchGestureResult(pinchId, { x: 0.6, y: 0.5, z: 0 })],
      350,
    );
    frame = controller.update(stable, [fistFrame, pinchFrame], 350);
    expect(frame.state).toBe(InteractionState.GRABBING_PIECE);

    stable = stateMachine.update([closedFistGestureResult(fistId), openPalmGestureResult(pinchId)], 400);
    frame = controller.update(stable, [fistFrame, pinchFrame], 400);
    expect(frame.state).toBe(InteractionState.IDLE);

    const voxelAfter = grid.get(a.id)!;
    expect(voxelAfter.gridX).toBe(0); // coordenada de grade não muda no modo livre
    expect(voxelAfter.gridY).toBe(0);
    expect(voxelAfter.gridZ).toBe(0);

    const freeTransform = grid.getFreeTransform(voxelAfter.groupId);
    expect(freeTransform).toBeDefined();
    expect(freeTransform!.offset.x).not.toBe(0); // realmente ficou deslocada
    expect(history.canUndo).toBe(true);
  });

  it('cancels the grab (nothing committed) when a hand is lost mid-hold', () => {
    const { controller, grid, history, voxelRenderer } = setupController();
    const a = grid.add({ x: 0, y: 0, z: 0 })!;
    voxelRenderer.update(grid.all(), grid.version);

    const stateMachine = new GestureStateMachine();
    const fistId = 'left';
    const pinchId = 'right';
    const fistFrame = makeHandFrameAt(fistId, { x: 0.5, y: 0.5, z: 0 });
    const pinchFrame = makeHandFrame(pinchId);

    stateMachine.update([closedFistGestureResult(fistId)], 0);
    let stable = stateMachine.update(
      [closedFistGestureResult(fistId), pinchGestureResult(pinchId, { x: 0.5, y: 0.5, z: 0 })],
      300,
    );
    let frame = controller.update(stable, [fistFrame, pinchFrame], 300);
    expect(frame.state).toBe(InteractionState.GRABBING_PIECE);

    // A mão do punho some do quadro além da janela de graça (400ms), sem soltar o gesto.
    stable = stateMachine.update([pinchGestureResult(pinchId, { x: 0.6, y: 0.5, z: 0 })], 900);
    frame = controller.update(stable, [pinchFrame], 900);

    expect(frame.state).toBe(InteractionState.IDLE);
    expect(history.canUndo).toBe(false);
    expect(grid.get(a.id)).toMatchObject({ gridX: 0, gridY: 0, gridZ: 0 });
  });
});
