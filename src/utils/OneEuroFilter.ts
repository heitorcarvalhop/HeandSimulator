/** Filtro passa-baixa adaptativo: suaviza forte quando o sinal está parado (remove tremor) e suaviza pouco quando se move rápido (remove atraso). */
class LowPassFilter {
  private initialized = false;
  private storedValue = 0;

  filter(value: number, alpha: number): number {
    if (!this.initialized) {
      this.storedValue = value;
      this.initialized = true;
      return value;
    }
    const result = alpha * value + (1 - alpha) * this.storedValue;
    this.storedValue = result;
    return result;
  }

  get last(): number {
    return this.storedValue;
  }

  reset(): void {
    this.initialized = false;
    this.storedValue = 0;
  }
}

function computeAlpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export interface OneEuroFilterOptions {
  minCutoff?: number;
  beta?: number;
  derivativeCutoff?: number;
}

export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private derivativeCutoff: number;

  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private lastTime: number | null = null;
  private lastValue = 0;

  constructor(options: OneEuroFilterOptions = {}) {
    this.minCutoff = options.minCutoff ?? 1.0;
    this.beta = options.beta ?? 0.0;
    this.derivativeCutoff = options.derivativeCutoff ?? 1.0;
  }

  filter(value: number, timestampMs: number): number {
    if (this.lastTime === null) {
      this.lastTime = timestampMs;
      this.lastValue = value;
      this.xFilter.filter(value, 1);
      this.dxFilter.filter(0, 1);
      return value;
    }

    let dt = (timestampMs - this.lastTime) / 1000;
    if (dt <= 0) dt = 1 / 60;
    this.lastTime = timestampMs;

    const dValue = (value - this.lastValue) / dt;
    this.lastValue = value;

    const edValue = this.dxFilter.filter(dValue, computeAlpha(this.derivativeCutoff, dt));

    const cutoff = this.minCutoff + this.beta * Math.abs(edValue);
    const filtered = this.xFilter.filter(value, computeAlpha(cutoff, dt));

    return filtered;
  }

  reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
    this.lastValue = 0;
  }
}
