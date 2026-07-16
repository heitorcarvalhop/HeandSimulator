import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandFrame, HandTrackingResult, Handedness, Landmark } from './HandTypes';
import { LandmarkSmoother } from './LandmarkSmoother';

const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm';
const MODEL_ASSET_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandTrackerInitError extends Error {}

/**
 * Envolve o HandLandmarker do MediaPipe para rastrear até 2 mãos a partir de um <video>.
 * O vídeo não é espelhado para o modelo (a classificação de mão assume entrada crua),
 * então aqui espelhamos o X dos landmarks e invertemos Left/Right para bater com o
 * vídeo espelhado por CSS que o usuário realmente vê.
 */
export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private readonly smoother = new LandmarkSmoother();
  private busy = false;
  private lastVideoTimeMs = -1;

  async initialize(): Promise<void> {
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_ASSET_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (error) {
      throw new HandTrackerInitError(
        `Falha ao carregar o modelo MediaPipe Hand Landmarker: ${(error as Error).message}`,
      );
    }
  }

  get isReady(): boolean {
    return this.landmarker !== null;
  }

  /** Roda a inferência no frame atual; retorna null se ocupado, não pronto, ou frame repetido. */
  process(video: HTMLVideoElement, nowMs: number): HandTrackingResult | null {
    if (!this.landmarker || this.busy) return null;
    if (video.readyState < 2) return null;
    if (video.currentTime === this.lastVideoTimeMs) return null;

    this.busy = true;
    try {
      this.lastVideoTimeMs = video.currentTime;
      const detection = this.landmarker.detectForVideo(video, nowMs);

      const activeIds = new Set<string>();
      const hands: HandFrame[] = [];
      const dedupeCounts = new Map<Handedness, number>();

      const count = detection.landmarks.length;
      for (let i = 0; i < count; i++) {
        const rawLandmarks = detection.landmarks[i];
        const handednessCandidates = detection.handedness[i];
        const rawLabel = (handednessCandidates?.[0]?.categoryName ?? 'Right') as Handedness;
        const confidence = handednessCandidates?.[0]?.score ?? 0;

        // Inverte o rótulo porque o modelo viu o frame cru (não espelhado).
        const correctedHandedness: Handedness = rawLabel === 'Left' ? 'Right' : 'Left';
        const handId = this.assignStableId(correctedHandedness, dedupeCounts);
        activeIds.add(handId);

        const mirroredLandmarks: Landmark[] = rawLandmarks.map((p) => ({
          x: 1 - p.x,
          y: p.y,
          z: p.z,
        }));

        const smoothedLandmarks = this.smoother.smooth(handId, mirroredLandmarks, nowMs);

        hands.push({
          handId,
          handedness: correctedHandedness,
          confidence,
          rawLandmarks,
          landmarks: mirroredLandmarks,
          smoothedLandmarks,
          timestampMs: nowMs,
        });
      }

      this.smoother.pruneMissing(activeIds);

      return { hands, timestampMs: nowMs };
    } finally {
      this.busy = false;
    }
  }

  /** Id estável por mão (baseado na lateralidade), com sufixo caso as duas mãos tenham o mesmo rótulo no frame. */
  private assignStableId(handedness: Handedness, dedupeCounts: Map<Handedness, number>): string {
    const countSoFar = dedupeCounts.get(handedness) ?? 0;
    dedupeCounts.set(handedness, countSoFar + 1);
    return countSoFar === 0 ? handedness.toLowerCase() : `${handedness.toLowerCase()}-${countSoFar}`;
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.smoother.reset();
  }
}
