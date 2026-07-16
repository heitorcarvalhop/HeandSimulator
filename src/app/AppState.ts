import {
  DEFAULT_MODEL_TRANSFORM,
  DEFAULT_SCENE_SETTINGS,
  type ModelTransform,
  type SceneSettings,
} from '../voxels/VoxelSerializer';

function cloneTransform(t: ModelTransform): ModelTransform {
  return { position: { ...t.position }, rotation: { ...t.rotation }, scale: t.scale };
}

function copyTransformInPlace(target: ModelTransform, source: ModelTransform): void {
  target.position.x = source.position.x;
  target.position.y = source.position.y;
  target.position.z = source.position.z;
  target.rotation.x = source.rotation.x;
  target.rotation.y = source.rotation.y;
  target.rotation.z = source.rotation.z;
  target.scale = source.scale;
}

/**
 * `transform` é `readonly` (o objeto nunca é reatribuído) porque o InteractionController
 * e o MouseFallbackController guardam uma referência direta a ele e o mutam durante os
 * arrastes — reatribuir o objeto os deixaria dessincronizados do que é renderizado.
 */
export class AppState {
  readonly transform: ModelTransform = cloneTransform(DEFAULT_MODEL_TRANSFORM);
  settings: SceneSettings = { ...DEFAULT_SCENE_SETTINGS };
  debug = false;
  cameraActive = false;

  resetTransform(): void {
    copyTransformInPlace(this.transform, DEFAULT_MODEL_TRANSFORM);
  }

  applyTransform(source: ModelTransform): void {
    copyTransformInPlace(this.transform, source);
  }
}
