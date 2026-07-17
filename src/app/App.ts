import * as THREE from 'three';
import { CameraError, CameraManager } from '../camera/CameraManager';
import { HandTracker, HandTrackerInitError } from '../hand-tracking/HandTracker';
import { GestureRecognizer, DEFAULT_PINCH_CONFIG } from '../hand-tracking/GestureRecognizer';
import { GestureStateMachine, type StableGesture } from '../hand-tracking/GestureStateMachine';
import { GestureType, type GestureResult, type HandFrame } from '../hand-tracking/HandTypes';
import { SceneManager, LOW_QUALITY } from '../rendering/SceneManager';
import { OverlayRenderer, type OverlayCursorData, type OverlayHandData, type OverlayHoverData } from '../rendering/OverlayRenderer';
import { VoxelGrid } from '../voxels/VoxelGrid';
import { VoxelRenderer } from '../voxels/VoxelRenderer';
import { buildLetterRShape } from '../voxels/VoxelBuilder';
import { DEFAULT_VOXEL_COLOR, makeGroupId } from '../voxels/Voxel';
import { HistoryManager } from '../history/HistoryManager';
import { AddVoxelsCommand, ClearAllCommand, CompositeCommand, type NewVoxelSpec } from '../history/VoxelCommands';
import type { Command } from '../history/Command';
import { InteractionController, type InteractionFrameResult } from '../interaction/InteractionController';
import type { InteractionMode } from '../interaction/InteractionTypes';
import { Hud, type HudData } from '../ui/Hud';
import { Controls, type ControlsCallbacks } from '../ui/Controls';
import { MouseFallbackController } from '../ui/MouseFallbackController';
import { StorageService } from '../storage/StorageService';
import { AppState } from './AppState';

const AUTO_QUALITY_FPS_THRESHOLD = 38;
const AUTO_QUALITY_SUSTAIN_MS = 4000;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento ausente: #${id}`);
  return el as T;
}

/** Orquestrador principal: liga todos os módulos e conduz o loop de renderização. */
export class App {
  private readonly video = byId<HTMLVideoElement>('webcam-video');
  private readonly permissionScreen = byId<HTMLDivElement>('permission-screen');
  private readonly errorScreen = byId<HTMLDivElement>('error-screen');
  private readonly errorMessageEl = byId<HTMLParagraphElement>('error-message');
  private readonly permissionMessageEl = byId<HTMLParagraphElement>('permission-message');
  private readonly gestureHintEl = byId<HTMLDivElement>('gesture-hint');

  private readonly appState = new AppState();
  private readonly grid = new VoxelGrid();
  private readonly history = new HistoryManager();
  private readonly storage = new StorageService();
  private readonly cameraManager = new CameraManager(this.video);
  private readonly handTracker = new HandTracker();
  private readonly gestureRecognizer = new GestureRecognizer(DEFAULT_PINCH_CONFIG);
  private readonly gestureStateMachine = new GestureStateMachine();

  private sceneManager!: SceneManager;
  private overlayRenderer!: OverlayRenderer;
  private voxelRenderer!: VoxelRenderer;
  private interactionController!: InteractionController;
  private modelRoot!: THREE.Group;
  private hud!: Hud;
  private controls!: Controls;
  private mouseFallback!: MouseFallbackController;

  private lastHandFrames: HandFrame[] = [];
  private lastGestureResults: GestureResult[] = [];
  private handTrackingReady = false;

  private rafHandle = 0;
  private lastFrameTime = performance.now();
  private smoothedFps = 60;
  private lowFpsSinceMs: number | null = null;

  async initialize(): Promise<void> {
    try {
      this.setupScene();
    } catch (error) {
      this.showError(`WebGL indisponível neste navegador/dispositivo: ${(error as Error).message}`);
      return;
    }

    this.setupUi();
    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    byId<HTMLButtonElement>('retry-button').addEventListener('click', () => void this.startWithCamera());
    byId<HTMLButtonElement>('skip-camera-button').addEventListener('click', () => this.continueWithoutCamera());

    this.handleResize();
    this.loop(performance.now());

    // Roda em Electron (não mais um site que exige clique do usuário), então a câmera
    // é solicitada automaticamente assim que o app inicializa.
    void this.startWithCamera();
  }

  private setupScene(): void {
    const canvas = byId<HTMLCanvasElement>('scene-canvas');
    this.sceneManager = new SceneManager(canvas);

    this.modelRoot = new THREE.Group();
    this.sceneManager.scene.add(this.modelRoot);

    this.voxelRenderer = new VoxelRenderer(this.appState.settings.voxelSize);
    this.modelRoot.add(this.voxelRenderer.group);

    this.interactionController = new InteractionController(
      this.sceneManager.coordinateMapper,
      this.grid,
      this.voxelRenderer,
      this.modelRoot,
      this.appState.transform,
      this.history,
      this.appState.settings.voxelSize,
    );

    const overlayCanvas = byId<HTMLCanvasElement>('overlay-canvas');
    this.overlayRenderer = new OverlayRenderer(overlayCanvas, this.sceneManager.coordinateMapper);
  }

  private setupUi(): void {
    this.hud = new Hud();

    const callbacks: ControlsCallbacks = {
      onToggleCamera: () => this.toggleVideoVisibility(),
      onClear: () => this.clearAll(),
      onUndo: () => this.history.undo(),
      onRedo: () => this.history.redo(),
      onDemoR: () => this.createDemoR(),
      onSave: () => this.saveScene(),
      onLoad: () => this.loadScene(),
      onExport: () => this.exportScene(),
      onImportFile: (file) => void this.importScene(file),
      onToggleDebug: () => this.toggleDebug(),
      onToggleBloom: () => this.toggleBloom(),
      onToggleSegmentMode: () => this.toggleSegmentMode(),
      onVoxelSizeChange: (size) => this.setVoxelSize(size),
      onSensitivityChange: (value) => this.setSensitivity(value),
      onModeChange: (mode) => this.interactionController.setMode(mode as InteractionMode),
    };
    this.controls = new Controls(callbacks);

    this.mouseFallback = new MouseFallbackController(
      this.sceneManager,
      this.grid,
      this.voxelRenderer,
      this.modelRoot,
      this.appState.transform,
      this.history,
      this.interactionController.selectionController,
      {
        onDemoR: () => this.createDemoR(),
        onClear: () => this.clearAll(),
        onToggleDebug: () => this.toggleDebug(),
        onDeleteSelected: () => this.interactionController.deleteSelected(),
        isCameraFallbackActive: () => true,
      },
    );

    this.setVideoVisible(this.appState.videoVisible);
  }

  private async startWithCamera(): Promise<void> {
    this.errorScreen.classList.add('hidden');
    this.permissionMessageEl.textContent = 'Solicitando acesso à câmera…';

    try {
      await this.cameraManager.start();
    } catch (error) {
      const message = error instanceof CameraError ? error.message : 'Erro desconhecido ao acessar a câmera.';
      this.showError(message);
      return;
    }

    this.video.addEventListener(
      'loadedmetadata',
      () => this.sceneManager.coordinateMapper.updateVideoSize(this.video.videoWidth, this.video.videoHeight),
      { once: true },
    );

    this.permissionMessageEl.textContent = 'Carregando modelo de rastreamento de mãos…';

    try {
      await this.handTracker.initialize();
      this.handTrackingReady = true;
    } catch (error) {
      const message = error instanceof HandTrackerInitError ? error.message : 'Falha ao carregar o MediaPipe.';
      this.cameraManager.stop();
      this.showError(message);
      return;
    }

    this.appState.cameraActive = true;
    this.permissionScreen.classList.add('hidden');
    this.hud.show();
  }

  private continueWithoutCamera(): void {
    this.errorScreen.classList.add('hidden');
    this.permissionScreen.classList.add('hidden');
    this.appState.cameraActive = false;
    this.hud.show();
  }

  /** Alterna só a exibição visual do vídeo (imagem da webcam vs. fundo preto); a captura e o rastreamento de mãos continuam ativos nos dois estados. */
  private toggleVideoVisibility(): void {
    this.setVideoVisible(!this.appState.videoVisible);
  }

  private setVideoVisible(visible: boolean): void {
    this.appState.videoVisible = visible;
    this.video.classList.toggle('video-hidden', !visible);
    this.controls.setCameraButtonState(visible);
  }

  private showError(message: string): void {
    this.permissionScreen.classList.add('hidden');
    this.errorScreen.classList.remove('hidden');
    this.errorMessageEl.textContent = message;
  }

  // ---- ações da barra de ferramentas ----

  private clearAll(): void {
    this.history.execute(new ClearAllCommand(this.grid));
    this.appState.resetTransform();
  }

  private createDemoR(): void {
    const shape = buildLetterRShape({ thickness: 1, depth: 2 });
    const groupId = makeGroupId();
    const specs: NewVoxelSpec[] = shape.map((coord) => ({ coord, color: DEFAULT_VOXEL_COLOR, groupId }));
    const commands: Command[] = [new ClearAllCommand(this.grid), new AddVoxelsCommand(this.grid, specs)];
    this.history.execute(new CompositeCommand(commands, 'Demonstração R'));
    this.appState.resetTransform();
  }

  private saveScene(): void {
    this.storage.save(this.grid, this.appState.transform, this.appState.settings);
    this.flashHint('Cena salva no LocalStorage');
  }

  private loadScene(): void {
    const result = this.storage.load();
    if (!result.ok) {
      this.flashHint(`Erro ao carregar: ${result.error}`);
      return;
    }
    this.storage.applyToGrid(result.scene, this.grid);
    this.appState.applyTransform(result.scene.model);
    this.appState.settings = result.scene.settings;
    this.setVoxelSize(result.scene.settings.voxelSize);
    this.flashHint('Cena carregada');
  }

  private exportScene(): void {
    const json = this.storage.exportToJsonString(this.grid, this.appState.transform, this.appState.settings);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `holo-voxel-scene-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private async importScene(file: File): Promise<void> {
    const text = await file.text();
    const result = this.storage.importFromJsonString(text);
    if (!result.ok) {
      this.flashHint(`Importação inválida: ${result.error}`);
      return;
    }
    this.storage.applyToGrid(result.scene, this.grid);
    this.appState.applyTransform(result.scene.model);
    this.appState.settings = result.scene.settings;
    this.setVoxelSize(result.scene.settings.voxelSize);
    this.flashHint('Cena importada com sucesso');
  }

  private toggleDebug(): void {
    this.appState.debug = !this.appState.debug;
    this.controls.setDebugButtonState(this.appState.debug);
  }

  private toggleBloom(): void {
    const enabled = this.sceneManager.toggleBloom();
    this.appState.settings.bloomEnabled = enabled;
    this.controls.setBloomButtonState(enabled);
  }

  private toggleSegmentMode(): void {
    const enabled = this.interactionController.toggleSegmentMode();
    this.controls.setSegmentButtonState(enabled);
  }

  private setVoxelSize(size: number): void {
    this.appState.settings.voxelSize = size;
    this.voxelRenderer.setVoxelSize(size);
    this.interactionController.setVoxelSize(size);
    this.mouseFallback.setVoxelSize(size);
    this.grid.version++;
  }

  private setSensitivity(value: number): void {
    this.appState.settings.sensitivity = value;
    this.sceneManager.coordinateMapper.setDepthConfig({ depthMultiplier: 9 * value });
  }

  private hintFlashUntilMs = 0;

  private flashHint(text: string): void {
    this.gestureHintEl.textContent = text;
    this.gestureHintEl.classList.add('visible');
    this.hintFlashUntilMs = performance.now() + 2200;
  }

  // ---- ciclo de vida ----

  private handleResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.sceneManager.resize(width, height);
    this.overlayRenderer.resize(width, height, Math.min(window.devicePixelRatio || 1, 2));
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.rafHandle);
      this.video.pause();
    } else {
      this.lastFrameTime = performance.now();
      if (this.appState.cameraActive) void this.video.play().catch(() => undefined);
      this.rafHandle = requestAnimationFrame(this.loop);
    }
  };

  private loop = (now: number): void => {
    const deltaMs = now - this.lastFrameTime;
    this.lastFrameTime = now;
    const instantFps = deltaMs > 0 ? 1000 / deltaMs : this.smoothedFps;
    this.smoothedFps = this.smoothedFps + (instantFps - this.smoothedFps) * 0.1;
    this.updateAutoQuality(now);

    if (this.appState.cameraActive && this.handTrackingReady) {
      const result = this.handTracker.process(this.video, now);
      if (result) {
        this.lastHandFrames = result.hands;
        this.lastGestureResults = result.hands.map((hand) => this.gestureRecognizer.recognize(hand, now));
      }
    } else {
      this.lastHandFrames = [];
      this.lastGestureResults = [];
    }

    const stableGestures = this.gestureStateMachine.update(this.lastGestureResults, now);
    const frameResult = this.interactionController.update(stableGestures, this.lastHandFrames, now);

    this.modelRoot.position.set(this.appState.transform.position.x, this.appState.transform.position.y, this.appState.transform.position.z);
    this.modelRoot.rotation.set(this.appState.transform.rotation.x, this.appState.transform.rotation.y, this.appState.transform.rotation.z);
    this.modelRoot.scale.setScalar(this.appState.transform.scale);
    this.modelRoot.updateMatrixWorld();

    this.voxelRenderer.update(this.grid.all(), this.grid.version);
    this.voxelRenderer.updateTime(now / 1000);

    this.renderOverlay(stableGestures, frameResult, now);
    this.updateHud(frameResult);

    if (now >= this.hintFlashUntilMs) {
      this.gestureHintEl.textContent = frameResult.hintText;
      this.gestureHintEl.classList.add('visible');
    }

    this.sceneManager.render();
    this.rafHandle = requestAnimationFrame(this.loop);
  };

  private updateAutoQuality(now: number): void {
    if (!this.appState.settings.qualityHigh) return;
    if (this.smoothedFps < AUTO_QUALITY_FPS_THRESHOLD) {
      if (this.lowFpsSinceMs === null) this.lowFpsSinceMs = now;
      else if (now - this.lowFpsSinceMs > AUTO_QUALITY_SUSTAIN_MS) {
        this.sceneManager.setQuality(LOW_QUALITY);
        this.appState.settings.qualityHigh = false;
        this.controls.setBloomButtonState(false);
      }
    } else {
      this.lowFpsSinceMs = null;
    }
  }

  private renderOverlay(
    stableGestures: StableGesture[],
    frameResult: InteractionFrameResult,
    now: number,
  ): void {
    const holdingHandIds = new Set(
      [frameResult.ownership.primaryHandId, frameResult.ownership.secondaryHandId].filter(
        (id): id is string => id !== null,
      ),
    );

    const hands: OverlayHandData[] = this.lastHandFrames.map((frame) => {
      const stable = stableGestures.find((g) => g.handId === frame.handId);
      return {
        handId: frame.handId,
        handedness: frame.handedness,
        landmarks: frame.smoothedLandmarks,
        gesture: stable?.type ?? GestureType.NONE,
        pinchStrength: stable?.result.pinchStrength ?? 0,
        isPinching: stable?.result.isPinching ?? false,
        isHolding: holdingHandIds.has(frame.handId),
      };
    });

    const cursors: OverlayCursorData[] = frameResult.cursors.map((cursor) => ({
      screenPos: cursor.screenPos,
      state: cursor.visualState,
      isPinching: cursor.isPinching,
      pinchStrength: cursor.pinchStrength,
    }));

    let hover: OverlayHoverData | null = null;
    if (frameResult.hoveredVoxelId) {
      const voxel = this.grid.get(frameResult.hoveredVoxelId);
      if (voxel) {
        const localPos = new THREE.Vector3(
          voxel.gridX * this.appState.settings.voxelSize,
          voxel.gridY * this.appState.settings.voxelSize,
          voxel.gridZ * this.appState.settings.voxelSize,
        );
        const worldPos = this.modelRoot.localToWorld(localPos);
        const screenPos = this.sceneManager.coordinateMapper.worldToScreen(worldPos);
        hover = { screenPos, gridCoord: { x: voxel.gridX, y: voxel.gridY, z: voxel.gridZ }, selected: voxel.selected };
      }
    }

    this.overlayRenderer.draw({
      hands,
      cursors,
      hover,
      timeSeconds: now / 1000,
      debug: this.appState.debug,
    });
  }

  private updateHud(frameResult: InteractionFrameResult): void {
    const selected = this.grid.selected();
    const leftGesture = this.lastGestureResults.find((g) => g.handedness === 'Left');
    const rightGesture = this.lastGestureResults.find((g) => g.handedness === 'Right');

    const data: HudData = {
      fps: this.smoothedFps,
      cameraLabel: this.appState.cameraActive ? this.cameraManager.resolutionLabel : 'desligada',
      handsDetected: this.lastHandFrames.length,
      gestureLeft: leftGesture ? leftGesture.type : '--',
      gestureRight: rightGesture ? rightGesture.type : '--',
      mode: `${this.interactionController.getMode()} · ${frameResult.state}`,
      voxelCount: this.grid.size,
      selectedLabel: selected.length === 0 ? '--' : selected.length === 1 ? `1 (${selected[0].gridX},${selected[0].gridY},${selected[0].gridZ})` : `${selected.length} voxels`,
      scale: this.appState.transform.scale,
      qualityLabel: this.appState.settings.qualityHigh ? 'alta' : 'baixa',
    };
    this.hud.update(data);
  }
}
