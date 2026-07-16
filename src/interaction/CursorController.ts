import * as THREE from 'three';
import { LandmarkIndex, type Handedness } from '../hand-tracking/HandTypes';
import type { StableGesture } from '../hand-tracking/GestureStateMachine';
import { GestureType } from '../hand-tracking/HandTypes';
import type { CoordinateMapper } from '../rendering/CoordinateMapper';

export type CursorVisualState = 'free' | 'hover' | 'selected' | 'valid' | 'invalid';

export interface HandCursor {
  handId: string;
  handedness: Handedness;
  worldPos: THREE.Vector3;
  screenPos: { x: number; y: number };
  isPinching: boolean;
  pinchStrength: number;
  gesture: GestureType;
  visualState: CursorVisualState;
  isPinchCursor: boolean;
}

/** Cursor por mão: ponto médio polegar-indicador durante a pinça, ou a ponta do indicador ao apontar/hover. */
export class CursorController {
  constructor(private readonly coordinateMapper: CoordinateMapper) {}

  computeCursor(gesture: StableGesture): HandCursor {
    const { result } = gesture;

    const sourceLandmark =
      result.pinchMidpoint ??
      result.pointingTip ??
      null;

    const fallback = sourceLandmark === null;
    const landmark = sourceLandmark ?? { x: 0.5, y: 0.5, z: 0 };

    const worldPos = this.coordinateMapper.landmarkToWorld(landmark);
    const screenPos = this.coordinateMapper.worldToScreen(worldPos);

    return {
      handId: result.handId,
      handedness: result.handedness,
      worldPos,
      screenPos,
      isPinching: result.isPinching,
      pinchStrength: result.pinchStrength,
      gesture: gesture.type,
      visualState: fallback ? 'free' : result.isPinching ? 'valid' : 'free',
      isPinchCursor: result.pinchMidpoint !== null,
    };
  }

  /** Posição de mundo do centro da palma, usada no teste de proximidade do punho/GRAB. */
  computePalmWorldPos(rawLandmarks: { x: number; y: number; z: number }[]): THREE.Vector3 {
    const wrist = rawLandmarks[LandmarkIndex.WRIST];
    const middleMcp = rawLandmarks[LandmarkIndex.MIDDLE_FINGER_MCP];
    const mid = {
      x: (wrist.x + middleMcp.x) / 2,
      y: (wrist.y + middleMcp.y) / 2,
      z: (wrist.z + middleMcp.z) / 2,
    };
    return this.coordinateMapper.landmarkToWorld(mid);
  }
}
