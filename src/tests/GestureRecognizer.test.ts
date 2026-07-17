import { describe, expect, it } from 'vitest';
import {
  computeNormalizedPinchDistance,
  computePalmSize,
  GestureRecognizer,
  isClosedFistPose,
  isOpenPalmPose,
  isPointingPose,
} from '../hand-tracking/GestureRecognizer';
import { GestureType, type HandFrame } from '../hand-tracking/HandTypes';
import {
  closedFistLandmarks,
  openPalmLandmarks,
  pinchLandmarks,
  pointingLandmarks,
  tightFistLandmarks,
} from './fixtures/handPoses';

function makeHandFrame(landmarks: ReturnType<typeof openPalmLandmarks>, handId = 'right'): HandFrame {
  return {
    handId,
    handedness: 'Right',
    confidence: 0.95,
    rawLandmarks: landmarks,
    landmarks,
    smoothedLandmarks: landmarks,
    timestampMs: 0,
  };
}

describe('computePalmSize / computeNormalizedPinchDistance', () => {
  it('returns a positive palm size for a plausible hand pose', () => {
    expect(computePalmSize(openPalmLandmarks())).toBeGreaterThan(0);
  });

  it('reports a small normalized pinch distance for a pinched hand', () => {
    const distance = computeNormalizedPinchDistance(pinchLandmarks());
    expect(distance).toBeLessThan(0.38);
  });

  it('reports a large normalized pinch distance for an open hand', () => {
    const distance = computeNormalizedPinchDistance(openPalmLandmarks());
    expect(distance).toBeGreaterThan(0.55);
  });

  it('normalizes by hand size so scaling the whole hand does not change the ratio', () => {
    const near = pinchLandmarks();
    const far = near.map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.4, y: 0.5 + (p.y - 0.5) * 0.4, z: p.z }));
    const nearRatio = computeNormalizedPinchDistance(near);
    const farRatio = computeNormalizedPinchDistance(far);
    expect(Math.abs(nearRatio - farRatio)).toBeLessThan(0.02);
  });
});

describe('pose classifiers', () => {
  it('recognizes an open palm', () => {
    expect(isOpenPalmPose(openPalmLandmarks())).toBe(true);
    expect(isClosedFistPose(openPalmLandmarks())).toBe(false);
  });

  it('recognizes a closed fist', () => {
    expect(isClosedFistPose(closedFistLandmarks())).toBe(true);
    expect(isOpenPalmPose(closedFistLandmarks())).toBe(false);
  });

  it('recognizes a pointing hand', () => {
    expect(isPointingPose(pointingLandmarks())).toBe(true);
    expect(isOpenPalmPose(pointingLandmarks())).toBe(false);
    expect(isClosedFistPose(pointingLandmarks())).toBe(false);
  });
});

describe('GestureRecognizer.recognize', () => {
  it('classifies an open palm frame as OPEN_PALM', () => {
    const recognizer = new GestureRecognizer();
    const result = recognizer.recognize(makeHandFrame(openPalmLandmarks()), 0);
    expect(result.type).toBe(GestureType.OPEN_PALM);
    expect(result.isPinching).toBe(false);
  });

  it('classifies a closed fist frame as CLOSED_FIST', () => {
    const recognizer = new GestureRecognizer();
    const result = recognizer.recognize(makeHandFrame(closedFistLandmarks()), 0);
    expect(result.type).toBe(GestureType.CLOSED_FIST);
  });

  it('classifies a closed fist as CLOSED_FIST even when the thumb ends up very close to the curled index (real-world ambiguity with pinch)', () => {
    const recognizer = new GestureRecognizer();
    const landmarks = tightFistLandmarks();
    // Confirms the fixture really would trip the pinch distance threshold on its own.
    expect(computeNormalizedPinchDistance(landmarks)).toBeLessThan(0.38);

    const result = recognizer.recognize(makeHandFrame(landmarks), 0);
    expect(result.type).toBe(GestureType.CLOSED_FIST);
    expect(result.isPinching).toBe(false);
    expect(result.pinchMidpoint).toBeNull();
  });

  it('never lets a held fist confirm into a pinch over time', () => {
    const recognizer = new GestureRecognizer({ minActivationMs: 0, debounceMs: 0 });
    const landmarks = tightFistLandmarks();
    const frame = makeHandFrame(landmarks);
    recognizer.recognize(frame, 0);
    const result = recognizer.recognize(frame, 200);
    expect(result.type).toBe(GestureType.CLOSED_FIST);
    expect(recognizer.isPinchConfirmed('right')).toBe(false);
  });

  it('drops an in-progress pinch as soon as the hand closes into a fist', () => {
    const recognizer = new GestureRecognizer({ minActivationMs: 0, debounceMs: 0 });
    recognizer.recognize(makeHandFrame(pinchLandmarks()), 0);
    expect(recognizer.isPinchConfirmed('right')).toBe(true);

    const result = recognizer.recognize(makeHandFrame(closedFistLandmarks()), 10);
    expect(result.type).toBe(GestureType.CLOSED_FIST);
    expect(result.isPinching).toBe(false);
    expect(recognizer.isPinchConfirmed('right')).toBe(false);
  });

  it('classifies a pointing frame as POINTING', () => {
    const recognizer = new GestureRecognizer();
    const result = recognizer.recognize(makeHandFrame(pointingLandmarks()), 0);
    expect(result.type).toBe(GestureType.POINTING);
    expect(result.pointingTip).not.toBeNull();
  });
});

describe('pinch hysteresis', () => {
  it('does not confirm a pinch before minActivationMs has elapsed', () => {
    const recognizer = new GestureRecognizer({ minActivationMs: 100, debounceMs: 0 });
    const frame = makeHandFrame(pinchLandmarks());
    const result = recognizer.recognize(frame, 0);
    expect(result.isPinching).toBe(false);
  });

  it('confirms a pinch once held past minActivationMs', () => {
    const recognizer = new GestureRecognizer({ minActivationMs: 100, debounceMs: 0 });
    const frame = makeHandFrame(pinchLandmarks());
    recognizer.recognize(frame, 0);
    const result = recognizer.recognize(frame, 150);
    expect(result.isPinching).toBe(true);
    expect(result.type).toBe(GestureType.PINCH);
  });

  it('uses a higher release threshold than the start threshold (hysteresis)', () => {
    const recognizer = new GestureRecognizer({ minActivationMs: 0, debounceMs: 0, startThreshold: 0.38, endThreshold: 0.55 });
    const pinchFrame = makeHandFrame(pinchLandmarks());
    recognizer.recognize(pinchFrame, 0);
    expect(recognizer.isPinchConfirmed('right')).toBe(true);

    // Distância com razão normalizada (~0.45) entre startThreshold e endThreshold:
    // dentro da banda de histerese, a pinça já confirmada não deve terminar ainda.
    const landmarks = pinchLandmarks();
    const wider = landmarks.map((p, i) => (i === 4 ? { ...p, x: 0.514 } : p));
    const midFrame = makeHandFrame(wider);
    recognizer.recognize(midFrame, 10);
    expect(recognizer.isPinchConfirmed('right')).toBe(true);
  });

  it('ends the pinch once distance exceeds the end threshold', () => {
    const recognizer = new GestureRecognizer({ minActivationMs: 0, debounceMs: 0 });
    recognizer.recognize(makeHandFrame(pinchLandmarks()), 0);
    expect(recognizer.isPinchConfirmed('right')).toBe(true);

    const opened = recognizer.recognize(makeHandFrame(openPalmLandmarks()), 10);
    expect(opened.isPinching).toBe(false);
    expect(recognizer.isPinchConfirmed('right')).toBe(false);
  });

  it('debounces rapid toggling near the threshold boundary', () => {
    const recognizer = new GestureRecognizer({ minActivationMs: 0, debounceMs: 200 });
    recognizer.recognize(makeHandFrame(pinchLandmarks()), 0);
    expect(recognizer.isPinchConfirmed('right')).toBe(true);

    // Tenta soltar imediatamente (dentro da janela de debounce) — deve ser ignorado.
    const released = recognizer.recognize(makeHandFrame(openPalmLandmarks()), 5);
    expect(released.isPinching).toBe(true);
  });

  it('reports pinch intensity between 0 and 1', () => {
    const recognizer = new GestureRecognizer({ minActivationMs: 0, debounceMs: 0 });
    const result = recognizer.recognize(makeHandFrame(pinchLandmarks()), 0);
    expect(result.pinchStrength).toBeGreaterThanOrEqual(0);
    expect(result.pinchStrength).toBeLessThanOrEqual(1);
  });
});
