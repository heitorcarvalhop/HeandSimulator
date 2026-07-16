import * as THREE from 'three';
import { CoordinateMapper } from './CoordinateMapper';
import { PostProcessing } from './PostProcessing';

export interface QualitySettings {
  bloomEnabled: boolean;
  pixelRatioCap: number;
  antialias: boolean;
}

export const HIGH_QUALITY: QualitySettings = { bloomEnabled: true, pixelRatioCap: 2, antialias: true };
export const LOW_QUALITY: QualitySettings = { bloomEnabled: false, pixelRatioCap: 1, antialias: false };

/** Renderer WebGL, cena de fundo transparente, câmera e pós-processamento, sobrepostos à webcam. */
export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly coordinateMapper: CoordinateMapper;
  readonly raycaster = new THREE.Raycaster();

  private postProcessing: PostProcessing;
  private quality: QualitySettings = { ...HIGH_QUALITY };

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
    this.camera.position.set(0, 0, 6);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: this.quality.antialias,
      premultipliedAlpha: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatioCap));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

    this.coordinateMapper = new CoordinateMapper(this.camera);

    const ambient = new THREE.AmbientLight(0x2a4c55, 1.2);
    this.scene.add(ambient);

    const key = new THREE.PointLight(0x6ff0ff, 6, 20, 2);
    key.position.set(2, 3, 4);
    this.scene.add(key);

    const rim = new THREE.PointLight(0x3070ff, 3, 20, 2);
    rim.position.set(-3, -2, 2);
    this.scene.add(rim);

    this.postProcessing = new PostProcessing(
      this.renderer,
      this.scene,
      this.camera,
      canvas.clientWidth,
      canvas.clientHeight,
    );
    this.postProcessing.setBloomEnabled(this.quality.bloomEnabled);
  }

  setQuality(quality: Partial<QualitySettings>): void {
    this.quality = { ...this.quality, ...quality };
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatioCap));
    this.postProcessing.setBloomEnabled(this.quality.bloomEnabled);
  }

  getQuality(): QualitySettings {
    return { ...this.quality };
  }

  toggleBloom(): boolean {
    const next = !this.postProcessing.isBloomEnabled();
    this.postProcessing.setBloomEnabled(next);
    this.quality.bloomEnabled = next;
    return next;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.postProcessing.setSize(width, height);
    this.coordinateMapper.updateViewportSize(width, height);
  }

  screenPixelToNDC(x: number, y: number, target = new THREE.Vector2()): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    target.x = (x / rect.width) * 2 - 1;
    target.y = -(y / rect.height) * 2 + 1;
    return target;
  }

  render(): void {
    this.postProcessing.render();
  }

  dispose(): void {
    this.postProcessing.dispose();
    this.renderer.dispose();
  }
}
