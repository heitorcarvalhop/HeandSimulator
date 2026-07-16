export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

export function distance2D(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function distance3D(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function midpoint3D(a: Vec3, b: Vec3): Vec3 {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

export function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Menor diferença angular com sinal (rad), evita saltos ao cruzar a fronteira +-PI. */
export function angleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function movingAverage(previous: number, next: number, alpha: number): number {
  return previous + (next - previous) * alpha;
}

/** DDA 3D: preenche o caminho de células inteiras entre duas coordenadas (inclusive). */
export function dda3D(
  start: Vec3,
  end: Vec3,
): Array<{ x: number; y: number; z: number }> {
  const x0 = Math.round(start.x);
  const y0 = Math.round(start.y);
  const z0 = Math.round(start.z);
  const x1 = Math.round(end.x);
  const y1 = Math.round(end.y);
  const z1 = Math.round(end.z);

  const points: Array<{ x: number; y: number; z: number }> = [];

  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;

  const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 0);

  if (steps === 0) {
    points.push({ x: x0, y: y0, z: z0 });
    return points;
  }

  const seen = new Set<string>();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(lerp(x0, x1, t));
    const y = Math.round(lerp(y0, y1, t));
    const z = Math.round(lerp(z0, z1, t));
    const key = `${x}:${y}:${z}`;
    if (!seen.has(key)) {
      seen.add(key);
      points.push({ x, y, z });
    }
  }

  return points;
}

export function dominantAxis(delta: Vec3): 'x' | 'y' | 'z' {
  const ax = Math.abs(delta.x);
  const ay = Math.abs(delta.y);
  const az = Math.abs(delta.z);
  if (ax >= ay && ax >= az) return 'x';
  if (ay >= ax && ay >= az) return 'y';
  return 'z';
}
