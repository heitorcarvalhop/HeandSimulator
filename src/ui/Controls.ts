import type { InteractionMode } from '../interaction/InteractionTypes';

export interface ControlsCallbacks {
  onToggleCamera(): void;
  onClear(): void;
  onUndo(): void;
  onRedo(): void;
  onDemoR(): void;
  onSave(): void;
  onLoad(): void;
  onExport(): void;
  onImportFile(file: File): void;
  onToggleDebug(): void;
  onToggleBloom(): void;
  onToggleSegmentMode(): void;
  onVoxelSizeChange(size: number): void;
  onSensitivityChange(value: number): void;
  onModeChange(mode: InteractionMode): void;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento de controle ausente: #${id}`);
  return el as T;
}

/** Liga a barra de ferramentas recolhível aos callbacks do app. */
export class Controls {
  private readonly toggleButton = byId<HTMLButtonElement>('toolbar-toggle');
  private readonly content = byId<HTMLDivElement>('toolbar-content');
  private readonly importInput = byId<HTMLInputElement>('import-file-input');

  constructor(callbacks: ControlsCallbacks) {
    this.toggleButton.addEventListener('click', () => this.content.classList.toggle('collapsed'));

    byId<HTMLButtonElement>('btn-camera-toggle').addEventListener('click', () => callbacks.onToggleCamera());
    byId<HTMLButtonElement>('btn-clear').addEventListener('click', () => callbacks.onClear());
    byId<HTMLButtonElement>('btn-undo').addEventListener('click', () => callbacks.onUndo());
    byId<HTMLButtonElement>('btn-redo').addEventListener('click', () => callbacks.onRedo());
    byId<HTMLButtonElement>('btn-demo-r').addEventListener('click', () => callbacks.onDemoR());
    byId<HTMLButtonElement>('btn-save').addEventListener('click', () => callbacks.onSave());
    byId<HTMLButtonElement>('btn-load').addEventListener('click', () => callbacks.onLoad());
    byId<HTMLButtonElement>('btn-export').addEventListener('click', () => callbacks.onExport());
    byId<HTMLButtonElement>('btn-import').addEventListener('click', () => this.importInput.click());
    byId<HTMLButtonElement>('btn-debug').addEventListener('click', () => callbacks.onToggleDebug());
    byId<HTMLButtonElement>('btn-bloom').addEventListener('click', () => callbacks.onToggleBloom());
    byId<HTMLButtonElement>('btn-segment').addEventListener('click', () => callbacks.onToggleSegmentMode());

    this.importInput.addEventListener('change', () => {
      const file = this.importInput.files?.[0];
      if (file) callbacks.onImportFile(file);
      this.importInput.value = '';
    });

    byId<HTMLInputElement>('input-voxel-size').addEventListener('input', (e) => {
      callbacks.onVoxelSizeChange(Number((e.target as HTMLInputElement).value));
    });

    byId<HTMLInputElement>('input-sensitivity').addEventListener('input', (e) => {
      callbacks.onSensitivityChange(Number((e.target as HTMLInputElement).value));
    });

    byId<HTMLSelectElement>('select-mode').addEventListener('change', (e) => {
      callbacks.onModeChange((e.target as HTMLSelectElement).value as InteractionMode);
    });
  }

  setBloomButtonState(enabled: boolean): void {
    byId<HTMLButtonElement>('btn-bloom').classList.toggle('active', enabled);
  }

  setSegmentButtonState(enabled: boolean): void {
    byId<HTMLButtonElement>('btn-segment').classList.toggle('active', enabled);
  }

  setDebugButtonState(enabled: boolean): void {
    byId<HTMLButtonElement>('btn-debug').classList.toggle('active', enabled);
  }
}
