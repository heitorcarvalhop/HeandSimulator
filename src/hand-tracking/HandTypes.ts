export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** Índices dos 21 pontos do MediaPipe Hand Landmarker. */
export enum LandmarkIndex {
  WRIST = 0,
  THUMB_CMC = 1,
  THUMB_MCP = 2,
  THUMB_IP = 3,
  THUMB_TIP = 4,
  INDEX_FINGER_MCP = 5,
  INDEX_FINGER_PIP = 6,
  INDEX_FINGER_DIP = 7,
  INDEX_FINGER_TIP = 8,
  MIDDLE_FINGER_MCP = 9,
  MIDDLE_FINGER_PIP = 10,
  MIDDLE_FINGER_DIP = 11,
  MIDDLE_FINGER_TIP = 12,
  RING_FINGER_MCP = 13,
  RING_FINGER_PIP = 14,
  RING_FINGER_DIP = 15,
  RING_FINGER_TIP = 16,
  PINKY_MCP = 17,
  PINKY_PIP = 18,
  PINKY_DIP = 19,
  PINKY_TIP = 20,
}

export const HAND_CONNECTIONS: Array<[LandmarkIndex, LandmarkIndex]> = [
  [LandmarkIndex.WRIST, LandmarkIndex.THUMB_CMC],
  [LandmarkIndex.THUMB_CMC, LandmarkIndex.THUMB_MCP],
  [LandmarkIndex.THUMB_MCP, LandmarkIndex.THUMB_IP],
  [LandmarkIndex.THUMB_IP, LandmarkIndex.THUMB_TIP],
  [LandmarkIndex.WRIST, LandmarkIndex.INDEX_FINGER_MCP],
  [LandmarkIndex.INDEX_FINGER_MCP, LandmarkIndex.INDEX_FINGER_PIP],
  [LandmarkIndex.INDEX_FINGER_PIP, LandmarkIndex.INDEX_FINGER_DIP],
  [LandmarkIndex.INDEX_FINGER_DIP, LandmarkIndex.INDEX_FINGER_TIP],
  [LandmarkIndex.MIDDLE_FINGER_MCP, LandmarkIndex.MIDDLE_FINGER_PIP],
  [LandmarkIndex.MIDDLE_FINGER_PIP, LandmarkIndex.MIDDLE_FINGER_DIP],
  [LandmarkIndex.MIDDLE_FINGER_DIP, LandmarkIndex.MIDDLE_FINGER_TIP],
  [LandmarkIndex.RING_FINGER_MCP, LandmarkIndex.RING_FINGER_PIP],
  [LandmarkIndex.RING_FINGER_PIP, LandmarkIndex.RING_FINGER_DIP],
  [LandmarkIndex.RING_FINGER_DIP, LandmarkIndex.RING_FINGER_TIP],
  [LandmarkIndex.WRIST, LandmarkIndex.PINKY_MCP],
  [LandmarkIndex.PINKY_MCP, LandmarkIndex.PINKY_PIP],
  [LandmarkIndex.PINKY_PIP, LandmarkIndex.PINKY_DIP],
  [LandmarkIndex.PINKY_DIP, LandmarkIndex.PINKY_TIP],
  [LandmarkIndex.INDEX_FINGER_MCP, LandmarkIndex.MIDDLE_FINGER_MCP],
  [LandmarkIndex.MIDDLE_FINGER_MCP, LandmarkIndex.RING_FINGER_MCP],
  [LandmarkIndex.RING_FINGER_MCP, LandmarkIndex.PINKY_MCP],
];

export type Handedness = 'Left' | 'Right';

export enum GestureType {
  NONE = 'NONE',
  OPEN_PALM = 'OPEN_PALM',
  CLOSED_FIST = 'CLOSED_FIST',
  POINTING = 'POINTING',
  PINCH = 'PINCH',
  TWO_FINGER_PINCH = 'TWO_FINGER_PINCH',
  GRAB = 'GRAB',
}

export interface HandFrame {
  handId: string;
  handedness: Handedness;
  confidence: number;
  rawLandmarks: Landmark[];
  /** Landmarks já corrigidos para o espelhamento (x invertido) da câmera selfie. */
  landmarks: Landmark[];
  smoothedLandmarks: Landmark[];
  timestampMs: number;
}

export interface HandTrackingResult {
  hands: HandFrame[];
  timestampMs: number;
}

export interface GestureResult {
  type: GestureType;
  intensity: number;
  /** Força da pinça: 0 (aberta) a 1 (totalmente fechada), independente da histerese. */
  pinchStrength: number;
  isPinching: boolean;
  pinchMidpoint: Landmark | null;
  isPointing: boolean;
  pointingTip: Landmark | null;
  isFist: boolean;
  isOpenPalm: boolean;
  palmSize: number;
  handId: string;
  handedness: Handedness;
}
