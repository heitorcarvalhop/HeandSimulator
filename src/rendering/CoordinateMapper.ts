import * as THREE from 'three';
import { clamp } from '../utils/MathUtils';

export interface DepthRangeConfig {
  depthMultiplier: number;
  baseZ: number;
  minZ: number;
  maxZ: number;
}

const DEFAULT_DEPTH_CONFIG: DepthRangeConfig = {
  depthMultiplier: 9,
  baseZ: 0,
  minZ: -3.2,
  maxZ: 3.2,
};

/**
 * Converte entre os quatro espaços de coordenadas: landmark do MediaPipe, pixel do
 * viewport, mundo do Three.js e grade de voxels. Corrige o corte causado por
 * `object-fit: cover` no vídeo para que um dedo em um pixel da tela mapeie para o
 * mesmo ponto de mundo que um clique de mouse naquele pixel.
 */
export class CoordinateMapper {
  private viewportWidth = 1;
  private viewportHeight = 1;
  private videoWidth = 1;
  private videoHeight = 1;
  private depthConfig: DepthRangeConfig = { ...DEFAULT_DEPTH_CONFIG };

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  getCameraWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.camera.position);
  }

  updateViewportSize(width: number, height: number): void {
    this.viewportWidth = Math.max(width, 1);
    this.viewportHeight = Math.max(height, 1);
  }

  updateVideoSize(width: number, height: number): void {
    this.videoWidth = Math.max(width, 1);
    this.videoHeight = Math.max(height, 1);
  }

  setDepthConfig(partial: Partial<DepthRangeConfig>): void {
    this.depthConfig = { ...this.depthConfig, ...partial };
  }

  getDepthConfig(): DepthRangeConfig {
    return { ...this.depthConfig };
  }

  /** Converte um ponto normalizado do vídeo para normalizado do viewport, compensando o corte do object-fit: cover. */
  videoNormalizedToViewportNormalized(x: number, y: number): { x: number; y: number } {
    const scale = Math.max(this.viewportWidth / this.videoWidth, this.viewportHeight / this.videoHeight);
    const displayedWidth = this.videoWidth * scale;
    const displayedHeight = this.videoHeight * scale;
    const offsetX = (displayedWidth - this.viewportWidth) / 2;
    const offsetY = (displayedHeight - this.viewportHeight) / 2;

    const pxX = x * displayedWidth - offsetX;
    const pxY = y * displayedHeight - offsetY;

    return { x: pxX / this.viewportWidth, y: pxY / this.viewportHeight };
  }

  private computeDepth(landmarkZ: number, overrides?: Partial<DepthRangeConfig>): number {
    const cfg = overrides ? { ...this.depthConfig, ...overrides } : this.depthConfig;
    const raw = cfg.baseZ - landmarkZ * cfg.depthMultiplier;
    return clamp(raw, cfg.minZ, cfg.maxZ);
  }

  /** Lança um raio pelo NDC(x,y) e intersecta o plano mundo-Z = worldZ. */
  ndcToWorldAtZ(ndcX: number, ndcY: number, worldZ: number, target = new THREE.Vector3()): THREE.Vector3 {
    const near = new THREE.Vector3(ndcX, ndcY, -1).unproject(this.camera);
    const far = new THREE.Vector3(ndcX, ndcY, 1).unproject(this.camera);
    const direction = far.sub(near).normalize();
    const t = direction.z !== 0 ? (worldZ - near.z) / direction.z : 0;
    return target.copy(near).addScaledVector(direction, t);
  }

  screenToWorld(screenXPx: number, screenYPx: number, worldZ: number): THREE.Vector3 {
    const ndcX = (screenXPx / this.viewportWidth) * 2 - 1;
    const ndcY = -((screenYPx / this.viewportHeight) * 2 - 1);
    return this.ndcToWorldAtZ(ndcX, ndcY, worldZ);
  }

  worldToScreen(world: THREE.Vector3): { x: number; y: number } {
    const projected = world.clone().project(this.camera);
    return {
      x: (projected.x * 0.5 + 0.5) * this.viewportWidth,
      y: (-projected.y * 0.5 + 0.5) * this.viewportHeight,
    };
  }

  /** Converte um landmark do MediaPipe (já espelhado) direto para o mundo do Three.js. */
  landmarkToWorld(
    landmark: { x: number; y: number; z: number },
    depthOverrides?: Partial<DepthRangeConfig>,
  ): THREE.Vector3 {
    const viewportNorm = this.videoNormalizedToViewportNormalized(landmark.x, landmark.y);
    const ndcX = viewportNorm.x * 2 - 1;
    const ndcY = -(viewportNorm.y * 2 - 1);
    const worldZ = this.computeDepth(landmark.z, depthOverrides);
    return this.ndcToWorldAtZ(ndcX, ndcY, worldZ);
  }

  worldToGrid(world: THREE.Vector3, voxelSize: number): { x: number; y: number; z: number } {
    return {
      x: Math.round(world.x / voxelSize),
      y: Math.round(world.y / voxelSize),
      z: Math.round(world.z / voxelSize),
    };
  }

  gridToWorld(
    gridX: number,
    gridY: number,
    gridZ: number,
    voxelSize: number,
    target = new THREE.Vector3(),
  ): THREE.Vector3 {
    return target.set(gridX * voxelSize, gridY * voxelSize, gridZ * voxelSize);
  }
}
