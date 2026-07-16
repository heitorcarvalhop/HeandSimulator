import { GestureType, type GestureResult } from './HandTypes';

/** Tempo mínimo (ms) que um gesto bruto precisa se manter para virar o gesto "estável" da mão. */
const STABILITY_WINDOW_MS = 70;

/** Tempo de PUNHO FECHADO segurado antes de virar GRAB (intenção de mover o modelo inteiro). */
const GRAB_UPGRADE_MS = 180;

interface HandGestureTrack {
  rawType: GestureType;
  rawSince: number;
  stableType: GestureType;
  stableSince: number;
  lastResult: GestureResult;
}

export interface StableGesture {
  handId: string;
  type: GestureType;
  heldForMs: number;
  result: GestureResult;
}

/** Filtra o reconhecimento bruto por frame em um fluxo estável por mão, e promove PUNHO longo a GRAB. */
export class GestureStateMachine {
  private readonly tracks = new Map<string, HandGestureTrack>();

  update(results: GestureResult[], nowMs: number): StableGesture[] {
    const seen = new Set<string>();
    const out: StableGesture[] = [];

    for (const result of results) {
      seen.add(result.handId);
      out.push(this.updateHand(result, nowMs));
    }

    for (const id of this.tracks.keys()) {
      if (!seen.has(id)) this.tracks.delete(id);
    }

    return out;
  }

  private updateHand(result: GestureResult, nowMs: number): StableGesture {
    let track = this.tracks.get(result.handId);
    if (!track) {
      track = {
        rawType: result.type,
        rawSince: nowMs,
        stableType: result.type,
        stableSince: nowMs,
        lastResult: result,
      };
      this.tracks.set(result.handId, track);
    }

    if (result.type !== track.rawType) {
      track.rawType = result.type;
      track.rawSince = nowMs;
    }

    const heldRawFor = nowMs - track.rawSince;

    // PINCH e MÃO ABERTA (gesto universal de soltar/cancelar) precisam reagir na hora,
    // senão um arraste ficaria preso pela janela de estabilidade inteira.
    const promotesImmediately =
      result.type === GestureType.PINCH ||
      result.type === GestureType.NONE ||
      result.type === GestureType.OPEN_PALM;

    if (track.stableType !== track.rawType && (promotesImmediately || heldRawFor >= STABILITY_WINDOW_MS)) {
      track.stableType = track.rawType;
      track.stableSince = nowMs;
    }

    track.lastResult = result;

    let effectiveType = track.stableType;
    const heldForMs = nowMs - track.stableSince;

    if (effectiveType === GestureType.CLOSED_FIST && heldForMs >= GRAB_UPGRADE_MS) {
      effectiveType = GestureType.GRAB;
    }

    return {
      handId: result.handId,
      type: effectiveType,
      heldForMs,
      result,
    };
  }

  reset(): void {
    this.tracks.clear();
  }
}
