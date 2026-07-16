import { OneEuroFilter } from '../utils/OneEuroFilter';
import { clamp, distance3D } from '../utils/MathUtils';
import type { Landmark } from './HandTypes';

export interface LandmarkSmootherOptions {
  /** Menor = mais suave porém mais atraso. */
  minCutoff?: number;
  /** Maior = menos atraso em movimento rápido, à custa de mais tremor. */
  beta?: number;
  derivativeCutoff?: number;
  /** Movimento abaixo disso por frame é tratado como ruído e ignorado. */
  deadzone?: number;
  maxVelocityPerSecond?: number;
}

interface PerLandmarkFilters {
  x: OneEuroFilter;
  y: OneEuroFilter;
  z: OneEuroFilter;
  lastOutput: Landmark | null;
  lastTimestamp: number | null;
}

const DEFAULTS: Required<LandmarkSmootherOptions> = {
  minCutoff: 1.4,
  beta: 0.35,
  derivativeCutoff: 1.0,
  deadzone: 0.0015,
  maxVelocityPerSecond: 4.5,
};

/** Mantém um filtro One-Euro independente por landmark e por mão, com limite de velocidade e zona morta. */
export class LandmarkSmoother {
  private readonly options: Required<LandmarkSmootherOptions>;
  private readonly handStates = new Map<string, Map<number, PerLandmarkFilters>>();

  constructor(options: LandmarkSmootherOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  smooth(handId: string, landmarks: Landmark[], timestampMs: number): Landmark[] {
    let handState = this.handStates.get(handId);
    if (!handState) {
      handState = new Map();
      this.handStates.set(handId, handState);
    }

    return landmarks.map((point, index) => this.smoothPoint(handState!, index, point, timestampMs));
  }

  private smoothPoint(
    handState: Map<number, PerLandmarkFilters>,
    index: number,
    point: Landmark,
    timestampMs: number,
  ): Landmark {
    let filters = handState.get(index);
    if (!filters) {
      filters = {
        x: new OneEuroFilter(this.options),
        y: new OneEuroFilter(this.options),
        z: new OneEuroFilter(this.options),
        lastOutput: null,
        lastTimestamp: null,
      };
      handState.set(index, filters);
    }

    let input = point;

    if (filters.lastOutput && filters.lastTimestamp !== null) {
      const dt = Math.max((timestampMs - filters.lastTimestamp) / 1000, 1 / 240);
      const moved = distance3D(filters.lastOutput, point);

      if (moved < this.options.deadzone) {
        input = filters.lastOutput;
      } else {
        const maxStep = this.options.maxVelocityPerSecond * dt;
        if (moved > maxStep) {
          const t = maxStep / moved;
          input = {
            x: filters.lastOutput.x + (point.x - filters.lastOutput.x) * t,
            y: filters.lastOutput.y + (point.y - filters.lastOutput.y) * t,
            z: filters.lastOutput.z + (point.z - filters.lastOutput.z) * t,
          };
        }
      }
    }

    const smoothed: Landmark = {
      x: clamp(filters.x.filter(input.x, timestampMs), -1, 2),
      y: clamp(filters.y.filter(input.y, timestampMs), -1, 2),
      z: filters.z.filter(input.z, timestampMs),
    };

    filters.lastOutput = smoothed;
    filters.lastTimestamp = timestampMs;

    return smoothed;
  }

  /** Remove o histórico de mãos que sumiram, para reiniciar limpo quando reaparecerem. */
  pruneMissing(activeHandIds: Set<string>): void {
    for (const handId of this.handStates.keys()) {
      if (!activeHandIds.has(handId)) {
        this.handStates.delete(handId);
      }
    }
  }

  reset(): void {
    this.handStates.clear();
  }
}
