export interface HudData {
  fps: number;
  cameraLabel: string;
  handsDetected: number;
  gestureLeft: string;
  gestureRight: string;
  mode: string;
  voxelCount: number;
  selectedLabel: string;
  scale: number;
  qualityLabel: string;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento de HUD ausente: #${id}`);
  return el as T;
}

/** Painel HUD no canto superior esquerdo. */
export class Hud {
  private readonly root = byId<HTMLDivElement>('hud');
  private readonly fps = byId<HTMLSpanElement>('hud-fps');
  private readonly camera = byId<HTMLSpanElement>('hud-camera');
  private readonly hands = byId<HTMLSpanElement>('hud-hands');
  private readonly gestureLeft = byId<HTMLSpanElement>('hud-gesture-left');
  private readonly gestureRight = byId<HTMLSpanElement>('hud-gesture-right');
  private readonly mode = byId<HTMLSpanElement>('hud-mode');
  private readonly voxels = byId<HTMLSpanElement>('hud-voxels');
  private readonly selected = byId<HTMLSpanElement>('hud-selected');
  private readonly scale = byId<HTMLSpanElement>('hud-scale');
  private readonly quality = byId<HTMLSpanElement>('hud-quality');

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  update(data: HudData): void {
    this.fps.textContent = data.fps.toFixed(0);
    this.camera.textContent = data.cameraLabel;
    this.hands.textContent = String(data.handsDetected);
    this.gestureLeft.textContent = data.gestureLeft;
    this.gestureRight.textContent = data.gestureRight;
    this.mode.textContent = data.mode;
    this.voxels.textContent = String(data.voxelCount);
    this.selected.textContent = data.selectedLabel;
    this.scale.textContent = `${data.scale.toFixed(2)}x`;
    this.quality.textContent = data.qualityLabel;
  }
}
