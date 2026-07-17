export enum InteractionState {
  IDLE = 'IDLE',
  HOVERING = 'HOVERING',
  CREATING_VOXELS = 'CREATING_VOXELS',
  GRABBING_VOXEL = 'GRABBING_VOXEL',
  GRABBING_GROUP = 'GRABBING_GROUP',
  /** Punho fechado + pinça na outra mão: segura a peça pela ponta com posição/orientação livres. */
  GRABBING_PIECE = 'GRABBING_PIECE',
  MOVING_MODEL = 'MOVING_MODEL',
  ROTATING_MODEL = 'ROTATING_MODEL',
  SCALING_MODEL = 'SCALING_MODEL',
  SELECTING = 'SELECTING',
  DELETING = 'DELETING',
}

export interface InteractionOwnership {
  action: InteractionState;
  primaryHandId: string | null;
  secondaryHandId: string | null;
}

export type InteractionMode = 'automatic' | 'build' | 'edit' | 'transform';

export const EMPTY_OWNERSHIP: InteractionOwnership = {
  action: InteractionState.IDLE,
  primaryHandId: null,
  secondaryHandId: null,
};
