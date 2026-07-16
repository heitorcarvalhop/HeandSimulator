import { dda3D, dominantAxis, type Vec3 } from '../utils/MathUtils';
import type { GridCoord } from './Voxel';

/** Projeta `end` no eixo dominante do movimento e preenche o caminho com DDA 3D (linha reta em X, Y ou Z). */
export function computeCreationLine(start: GridCoord, end: GridCoord): GridCoord[] {
  const delta: Vec3 = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
  const axis = dominantAxis(delta);

  const projectedEnd: GridCoord = { ...start, [axis]: end[axis] };

  return dda3D(start, projectedEnd);
}

/** Linha 3D livre (sem travar em um eixo) entre duas células. */
export function computeFreeLine(start: GridCoord, end: GridCoord): GridCoord[] {
  return dda3D(start, end);
}

export function translateCoords(coords: GridCoord[], origin: GridCoord): GridCoord[] {
  return coords.map((c) => ({ x: c.x + origin.x, y: c.y + origin.y, z: c.z + origin.z }));
}

const LETTER_R_PATTERN = ['11110', '10001', '10001', '11110', '10100', '10010', '10001'];

export interface LetterROptions {
  /** Voxels por célula da matriz em X/Y (espessura do traço). */
  thickness?: number;
  /** Voxels extrudados em Z. */
  depth?: number;
}

/** Constrói a letra "R" a partir de uma matriz 7x5 fixa, centrada na origem. */
export function buildLetterRShape(options: LetterROptions = {}): GridCoord[] {
  const thickness = Math.max(1, Math.round(options.thickness ?? 1));
  const depth = Math.max(1, Math.round(options.depth ?? 1));
  const rows = LETTER_R_PATTERN.length;
  const cols = LETTER_R_PATTERN[0].length;

  const seen = new Set<string>();
  const coords: GridCoord[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (LETTER_R_PATTERN[row][col] !== '1') continue;

      // A linha 0 do bitmap é o topo da letra, que deve mapear para o Y mais alto.
      const baseY = (rows - 1 - row) * thickness;
      const baseX = col * thickness;

      for (let ty = 0; ty < thickness; ty++) {
        for (let tx = 0; tx < thickness; tx++) {
          for (let tz = 0; tz < depth; tz++) {
            const x = baseX + tx;
            const y = baseY + ty;
            const z = tz;
            const key = `${x}:${y}:${z}`;
            if (!seen.has(key)) {
              seen.add(key);
              coords.push({ x, y, z });
            }
          }
        }
      }
    }
  }

  const centerX = (cols * thickness - 1) / 2;
  const centerY = (rows * thickness - 1) / 2;
  const centerZ = (depth - 1) / 2;

  return coords.map((c) => ({
    x: Math.round(c.x - centerX),
    y: Math.round(c.y - centerY),
    z: Math.round(c.z - centerZ),
  }));
}
