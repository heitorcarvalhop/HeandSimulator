import { describe, expect, it } from 'vitest';
import { GestureStateMachine } from '../hand-tracking/GestureStateMachine';
import { GestureType, type GestureResult } from '../hand-tracking/HandTypes';

function makeResult(type: GestureType, handId = 'right'): GestureResult {
  return {
    type,
    intensity: type === GestureType.NONE ? 0 : 1,
    pinchStrength: type === GestureType.PINCH ? 1 : 0,
    isPinching: type === GestureType.PINCH,
    pinchMidpoint: null,
    isPointing: type === GestureType.POINTING,
    pointingTip: null,
    isFist: type === GestureType.CLOSED_FIST,
    isOpenPalm: type === GestureType.OPEN_PALM,
    palmSize: 0.2,
    handId,
    handedness: 'Right',
  };
}

describe('GestureStateMachine', () => {
  it('reports the gesture immediately on the first frame', () => {
    const machine = new GestureStateMachine();
    const [stable] = machine.update([makeResult(GestureType.OPEN_PALM)], 0);
    expect(stable.type).toBe(GestureType.OPEN_PALM);
  });

  it('does not flip to a new raw gesture until it has been stable for the debounce window', () => {
    const machine = new GestureStateMachine();
    machine.update([makeResult(GestureType.OPEN_PALM)], 0);
    // Um único frame ruidoso de POINTING não deve sobrepor OPEN_PALM imediatamente.
    const [flicker] = machine.update([makeResult(GestureType.POINTING)], 10);
    expect(flicker.type).toBe(GestureType.OPEN_PALM);
  });

  it('adopts a new gesture once it has been observed continuously past the stability window', () => {
    const machine = new GestureStateMachine();
    machine.update([makeResult(GestureType.OPEN_PALM)], 0);
    machine.update([makeResult(GestureType.POINTING)], 10);
    const [settled] = machine.update([makeResult(GestureType.POINTING)], 100);
    expect(settled.type).toBe(GestureType.POINTING);
  });

  it('promotes PINCH immediately without waiting for the stability window', () => {
    const machine = new GestureStateMachine();
    machine.update([makeResult(GestureType.OPEN_PALM)], 0);
    const [pinch] = machine.update([makeResult(GestureType.PINCH)], 1);
    expect(pinch.type).toBe(GestureType.PINCH);
  });

  it('upgrades a sufficiently long CLOSED_FIST into GRAB', () => {
    const machine = new GestureStateMachine();
    machine.update([makeResult(GestureType.CLOSED_FIST)], 0);
    const [early] = machine.update([makeResult(GestureType.CLOSED_FIST)], 100);
    expect(early.type).toBe(GestureType.CLOSED_FIST);

    const [late] = machine.update([makeResult(GestureType.CLOSED_FIST)], 300);
    expect(late.type).toBe(GestureType.GRAB);
  });

  it('forgets hands that stop appearing in updates', () => {
    const machine = new GestureStateMachine();
    machine.update([makeResult(GestureType.CLOSED_FIST, 'left')], 0);
    const results = machine.update([makeResult(GestureType.OPEN_PALM, 'right')], 10);
    expect(results.map((r) => r.handId)).toEqual(['right']);
  });
});
