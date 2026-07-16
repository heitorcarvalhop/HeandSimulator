import { GestureType, HAND_CONNECTIONS, LandmarkIndex, type Handedness, type Landmark } from '../hand-tracking/HandTypes';
import type { CoordinateMapper } from './CoordinateMapper';
import type { CursorVisualState } from '../interaction/CursorController';

export interface OverlayHandData {
  handId: string;
  handedness: Handedness;
  landmarks: Landmark[];
  gesture: GestureType;
  pinchStrength: number;
  isPinching: boolean;
  isHolding: boolean;
}

export interface OverlayCursorData {
  screenPos: { x: number; y: number };
  state: CursorVisualState;
  isPinching: boolean;
  pinchStrength: number;
}

export interface OverlayHoverData {
  screenPos: { x: number; y: number };
  gridCoord: { x: number; y: number; z: number };
  selected: boolean;
}

export interface OverlayDrawParams {
  hands: OverlayHandData[];
  cursors: OverlayCursorData[];
  hover: OverlayHoverData | null;
  timeSeconds: number;
  debug: boolean;
}

const GESTURE_LABELS: Record<GestureType, string> = {
  [GestureType.NONE]: '',
  [GestureType.OPEN_PALM]: 'MÃO ABERTA',
  [GestureType.CLOSED_FIST]: 'PUNHO',
  [GestureType.POINTING]: 'APONTANDO',
  [GestureType.PINCH]: 'PINÇA',
  [GestureType.TWO_FINGER_PINCH]: 'PINÇA DUPLA',
  [GestureType.GRAB]: 'SEGURANDO',
};

const CURSOR_COLORS: Record<CursorVisualState, string> = {
  free: '#3ce8ff',
  hover: '#ffffff',
  selected: '#ffe066',
  valid: '#38ffb0',
  invalid: '#ff4d4d',
};

/** Desenha o esqueleto holográfico da mão, cursores e marcador de hover no canvas 2D. */
export class OverlayRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly coordinateMapper: CoordinateMapper,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não foi possível obter o contexto 2D do canvas de overlay.');
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr: number): void {
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private toPixel(landmark: Landmark): { x: number; y: number } {
    const norm = this.coordinateMapper.videoNormalizedToViewportNormalized(landmark.x, landmark.y);
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    return { x: norm.x * width, y: norm.y * height };
  }

  draw(params: OverlayDrawParams): void {
    const { ctx } = this;
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, width, height);

    for (const hand of params.hands) this.drawHand(hand, params.timeSeconds);
    for (const cursor of params.cursors) this.drawCursor(cursor, params.timeSeconds);
    if (params.hover) this.drawHover(params.hover);

    if (params.debug) this.drawDebugGrid(width, height);
  }

  private drawHand(hand: OverlayHandData, timeSeconds: number): void {
    const { ctx } = this;
    const pulse = 0.7 + 0.3 * Math.sin(timeSeconds * 3);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(80, 230, 255, ${0.55 * pulse})`;
    ctx.lineWidth = 2;
    ctx.shadowColor = '#4fe8ff';
    ctx.shadowBlur = 8;

    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = this.toPixel(hand.landmarks[a]);
      const pb = this.toPixel(hand.landmarks[b]);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();

    ctx.fillStyle = `rgba(140, 245, 255, 0.9)`;
    for (let i = 0; i < hand.landmarks.length; i++) {
      const isTip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      const p = this.toPixel(hand.landmarks[i]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, isTip ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (hand.isPinching) {
      const thumb = this.toPixel(hand.landmarks[LandmarkIndex.THUMB_TIP]);
      const index = this.toPixel(hand.landmarks[LandmarkIndex.INDEX_FINGER_TIP]);
      const mid = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
      const radius = hand.isHolding ? 14 + 3 * pulse : 9 + 2 * pulse;
      ctx.strokeStyle = hand.isHolding ? 'rgba(255, 224, 102, 0.95)' : 'rgba(80, 240, 255, 0.9)';
      ctx.lineWidth = hand.isHolding ? 3 : 2;
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, radius, 0, Math.PI * 2 * hand.pinchStrength);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }

    ctx.restore();

    const label = GESTURE_LABELS[hand.gesture];
    if (label) {
      const wrist = this.toPixel(hand.landmarks[LandmarkIndex.WRIST]);
      ctx.save();
      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(170, 240, 255, 0.85)';
      ctx.textAlign = 'center';
      ctx.fillText(`${label}${hand.handedness === 'Left' ? ' · E' : ' · D'}`, wrist.x, wrist.y + 26);
      ctx.restore();
    }
  }

  private drawCursor(cursor: OverlayCursorData, timeSeconds: number): void {
    const { ctx } = this;
    const color = CURSOR_COLORS[cursor.state];
    const pulse = 0.6 + 0.4 * Math.sin(timeSeconds * 4);
    const baseRadius = cursor.isPinching ? 10 + cursor.pinchStrength * 8 : 14;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5 + 0.3 * pulse;
    ctx.beginPath();
    ctx.arc(cursor.screenPos.x, cursor.screenPos.y, baseRadius + 6 + 2 * pulse, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cursor.screenPos.x, cursor.screenPos.y, baseRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cursor.screenPos.x, cursor.screenPos.y, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawHover(hover: OverlayHoverData): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = hover.selected ? 'rgba(255, 224, 102, 0.9)' : 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(hover.screenPos.x - 22, hover.screenPos.y - 22, 44, 44);
    ctx.setLineDash([]);
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(210, 245, 255, 0.85)';
    ctx.fillText(`(${hover.gridCoord.x}, ${hover.gridCoord.y}, ${hover.gridCoord.z})`, hover.screenPos.x - 20, hover.screenPos.y - 28);
    ctx.restore();
  }

  private drawDebugGrid(width: number, height: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(80, 230, 255, 0.15)';
    ctx.lineWidth = 1;
    const step = 40;
    for (let x = 0; x < width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
  }
}
