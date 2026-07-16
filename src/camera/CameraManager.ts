export type CameraErrorReason =
  | 'permission-denied'
  | 'not-found'
  | 'not-supported'
  | 'in-use'
  | 'unknown';

export class CameraError extends Error {
  constructor(
    public readonly reason: CameraErrorReason,
    message: string,
  ) {
    super(message);
  }
}

/** Gerencia o MediaStream da webcam e o elemento <video>. O espelhamento é só CSS; o vídeo em si permanece cru. */
export class CameraManager {
  private stream: MediaStream | null = null;

  constructor(private readonly videoElement: HTMLVideoElement) {}

  get isActive(): boolean {
    return this.stream !== null && this.stream.getVideoTracks().some((t) => t.readyState === 'live');
  }

  get resolutionLabel(): string {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return '--';
    const settings = track.getSettings();
    if (!settings.width || !settings.height) return '--';
    return `${settings.width}x${settings.height}`;
  }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError('not-supported', 'Este navegador não suporta acesso à câmera (getUserMedia).');
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });

      this.stream = stream;
      this.videoElement.srcObject = stream;
      await this.videoElement.play();
    } catch (error) {
      throw this.toCameraError(error);
    }
  }

  stop(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    this.videoElement.srcObject = null;
  }

  private toCameraError(error: unknown): CameraError {
    const domError = error as DOMException;
    switch (domError?.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return new CameraError('permission-denied', 'Permissão de câmera negada pelo usuário ou navegador.');
      case 'NotFoundError':
      case 'OverconstrainedError':
        return new CameraError('not-found', 'Nenhuma câmera compatível foi encontrada.');
      case 'NotReadableError':
      case 'TrackStartError':
        return new CameraError('in-use', 'A câmera já está em uso por outro aplicativo.');
      default:
        return new CameraError('unknown', domError?.message ?? 'Erro desconhecido ao acessar a câmera.');
    }
  }
}
