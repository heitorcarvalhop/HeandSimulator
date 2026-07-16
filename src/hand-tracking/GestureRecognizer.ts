import { distance3D } from '../utils/MathUtils';
import { GestureType, LandmarkIndex, type GestureResult, type HandFrame, type Landmark } from './HandTypes';

const FINGER_TIPS = [
  LandmarkIndex.INDEX_FINGER_TIP,
  LandmarkIndex.MIDDLE_FINGER_TIP,
  LandmarkIndex.RING_FINGER_TIP,
  LandmarkIndex.PINKY_TIP,
] as const;

const FINGER_MCPS = [
  LandmarkIndex.INDEX_FINGER_MCP,
  LandmarkIndex.MIDDLE_FINGER_MCP,
  LandmarkIndex.RING_FINGER_MCP,
  LandmarkIndex.PINKY_MCP,
] as const;

/** Tamanho da palma, usado para normalizar distâncias independente da mão estar perto ou longe da câmera. */
export function computePalmSize(landmarks: Landmark[]): number {
  const wrist = landmarks[LandmarkIndex.WRIST];
  const middleMcp = landmarks[LandmarkIndex.MIDDLE_FINGER_MCP];
  const indexMcp = landmarks[LandmarkIndex.INDEX_FINGER_MCP];
  const pinkyMcp = landmarks[LandmarkIndex.PINKY_MCP];

  const length = distance3D(wrist, middleMcp);
  const width = distance3D(indexMcp, pinkyMcp);

  return Math.max((length + width) / 2, 1e-5);
}

export function computeRawPinchDistance(landmarks: Landmark[]): number {
  return distance3D(landmarks[LandmarkIndex.THUMB_TIP], landmarks[LandmarkIndex.INDEX_FINGER_TIP]);
}

/** Distância da pinça normalizada pelo tamanho da palma. */
export function computeNormalizedPinchDistance(landmarks: Landmark[]): number {
  return computeRawPinchDistance(landmarks) / computePalmSize(landmarks);
}

function fingerExtension(landmarks: Landmark[], tip: LandmarkIndex, mcp: LandmarkIndex): number {
  const wrist = landmarks[LandmarkIndex.WRIST];
  const tipToWrist = distance3D(landmarks[tip], wrist);
  const mcpToWrist = distance3D(landmarks[mcp], wrist);
  return tipToWrist / Math.max(mcpToWrist, 1e-5);
}

function thumbExtension(landmarks: Landmark[]): number {
  const pinkyMcp = landmarks[LandmarkIndex.PINKY_MCP];
  const thumbTip = landmarks[LandmarkIndex.THUMB_TIP];
  const thumbMcp = landmarks[LandmarkIndex.THUMB_MCP];
  return distance3D(thumbTip, pinkyMcp) / Math.max(distance3D(thumbMcp, pinkyMcp), 1e-5);
}

/** Razão de extensão (0 = recolhido, 1+ = estendido) dos 4 dedos longos. */
export function fingerExtensions(landmarks: Landmark[]): number[] {
  return FINGER_TIPS.map((tip, i) => fingerExtension(landmarks, tip, FINGER_MCPS[i]));
}

const EXTENDED_THRESHOLD = 1.25;
const CURLED_THRESHOLD = 1.05;

export function isOpenPalmPose(landmarks: Landmark[]): boolean {
  const extensions = fingerExtensions(landmarks);
  const allExtended = extensions.every((e) => e > EXTENDED_THRESHOLD);
  const thumbOut = thumbExtension(landmarks) > 0.85;
  return allExtended && thumbOut;
}

export function isClosedFistPose(landmarks: Landmark[]): boolean {
  const extensions = fingerExtensions(landmarks);
  return extensions.every((e) => e < CURLED_THRESHOLD);
}

export function isPointingPose(landmarks: Landmark[]): boolean {
  const [index, middle, ring, pinky] = fingerExtensions(landmarks);
  return index > EXTENDED_THRESHOLD && middle < CURLED_THRESHOLD && ring < CURLED_THRESHOLD && pinky < CURLED_THRESHOLD;
}

export function isTwoFingerPinchPose(landmarks: Landmark[]): boolean {
  const palmSize = computePalmSize(landmarks);
  const thumbTip = landmarks[LandmarkIndex.THUMB_TIP];
  const indexTip = landmarks[LandmarkIndex.INDEX_FINGER_TIP];
  const middleTip = landmarks[LandmarkIndex.MIDDLE_FINGER_TIP];
  const thumbToIndex = distance3D(thumbTip, indexTip) / palmSize;
  const thumbToMiddle = distance3D(thumbTip, middleTip) / palmSize;
  return thumbToIndex < 0.45 && thumbToMiddle < 0.55;
}

export interface PinchHysteresisConfig {
  /** Distância normalizada abaixo da qual a pinça pode iniciar. */
  startThreshold: number;
  /** Distância normalizada acima da qual a pinça termina (deve ser maior que startThreshold). */
  endThreshold: number;
  /** Tempo mínimo entre alternâncias, evita oscilação perto do limiar. */
  debounceMs: number;
  /** Tempo mínimo de pinça ativa antes de ser confirmada. */
  minActivationMs: number;
}

export const DEFAULT_PINCH_CONFIG: PinchHysteresisConfig = {
  startThreshold: 0.38,
  endThreshold: 0.55,
  debounceMs: 60,
  minActivationMs: 40,
};

interface PinchTrackState {
  isPinching: boolean;
  confirmed: boolean;
  lastToggleTime: number;
  pinchStartTime: number | null;
}

/** Reconhece gestos a partir dos landmarks de uma mão. A pinça tem histerese/debounce próprios; o resto é sem estado. */
export class GestureRecognizer {
  private readonly pinchConfig: PinchHysteresisConfig;
  private readonly pinchStates = new Map<string, PinchTrackState>();

  constructor(pinchConfig: Partial<PinchHysteresisConfig> = {}) {
    this.pinchConfig = { ...DEFAULT_PINCH_CONFIG, ...pinchConfig };
  }

  recognize(hand: HandFrame, nowMs: number): GestureResult {
    const landmarks = hand.smoothedLandmarks;
    const palmSize = computePalmSize(landmarks);
    const normalizedPinch = computeNormalizedPinchDistance(landmarks);

    const pinchState = this.updatePinchState(hand.handId, normalizedPinch, nowMs);
    const pinchStrength = 1 - Math.min(normalizedPinch / this.pinchConfig.endThreshold, 1);

    const openPalm = isOpenPalmPose(landmarks);
    const fist = isClosedFistPose(landmarks);
    const pointing = isPointingPose(landmarks) && !pinchState.confirmed;
    const twoFingerPinch = isTwoFingerPinchPose(landmarks) && !pinchState.confirmed;

    const pinchMidpoint = pinchState.confirmed
      ? midpoint(landmarks[LandmarkIndex.THUMB_TIP], landmarks[LandmarkIndex.INDEX_FINGER_TIP])
      : null;

    let type = GestureType.NONE;
    if (pinchState.confirmed) type = GestureType.PINCH;
    else if (twoFingerPinch) type = GestureType.TWO_FINGER_PINCH;
    else if (pointing) type = GestureType.POINTING;
    else if (fist) type = GestureType.CLOSED_FIST;
    else if (openPalm) type = GestureType.OPEN_PALM;

    return {
      type,
      intensity: type === GestureType.NONE ? 0 : 1,
      pinchStrength: Math.max(0, Math.min(pinchStrength, 1)),
      isPinching: pinchState.confirmed,
      pinchMidpoint,
      isPointing: pointing,
      pointingTip: pointing ? landmarks[LandmarkIndex.INDEX_FINGER_TIP] : null,
      isFist: fist,
      isOpenPalm: openPalm,
      palmSize,
      handId: hand.handId,
      handedness: hand.handedness,
    };
  }

  private updatePinchState(handId: string, normalizedDistance: number, nowMs: number): PinchTrackState {
    let state = this.pinchStates.get(handId);
    if (!state) {
      state = { isPinching: false, confirmed: false, lastToggleTime: -Infinity, pinchStartTime: null };
      this.pinchStates.set(handId, state);
    }

    const { startThreshold, endThreshold, debounceMs, minActivationMs } = this.pinchConfig;
    const sinceToggle = nowMs - state.lastToggleTime;

    if (!state.isPinching && normalizedDistance < startThreshold && sinceToggle > debounceMs) {
      state.isPinching = true;
      state.lastToggleTime = nowMs;
      state.pinchStartTime = nowMs;
    } else if (state.isPinching && normalizedDistance > endThreshold && sinceToggle > debounceMs) {
      state.isPinching = false;
      state.confirmed = false;
      state.lastToggleTime = nowMs;
      state.pinchStartTime = null;
    }

    if (state.isPinching && !state.confirmed && state.pinchStartTime !== null) {
      if (nowMs - state.pinchStartTime >= minActivationMs) {
        state.confirmed = true;
      }
    }

    return state;
  }

  /** Duração (ms) da pinça atual, ou 0 se não estiver pinçando. */
  pinchHoldDuration(handId: string, nowMs: number): number {
    const state = this.pinchStates.get(handId);
    if (!state || !state.isPinching || state.pinchStartTime === null) return 0;
    return nowMs - state.pinchStartTime;
  }

  isPinchConfirmed(handId: string): boolean {
    return this.pinchStates.get(handId)?.confirmed ?? false;
  }

  pruneMissing(activeHandIds: Set<string>): void {
    for (const id of this.pinchStates.keys()) {
      if (!activeHandIds.has(id)) this.pinchStates.delete(id);
    }
  }

  reset(): void {
    this.pinchStates.clear();
  }
}

function midpoint(a: Landmark, b: Landmark): Landmark {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}
