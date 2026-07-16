import { LandmarkIndex, type Landmark } from '../../hand-tracking/HandTypes';

function lerpPoint(a: Landmark, b: Landmark, t: number): Landmark {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

interface FingerEndpoints {
  mcp: Landmark;
  tip: Landmark;
}

interface HandPoseSpec {
  wrist: Landmark;
  thumbMcp: Landmark;
  thumbTip: Landmark;
  index: FingerEndpoints;
  middle: FingerEndpoints;
  ring: FingerEndpoints;
  pinky: FingerEndpoints;
}

/** Monta os 21 landmarks a partir de poucas juntas-chave, interpolando o resto. */
function buildLandmarks(spec: HandPoseSpec): Landmark[] {
  const points: Landmark[] = new Array(21);
  points[LandmarkIndex.WRIST] = spec.wrist;

  const thumbCmc = lerpPoint(spec.wrist, spec.thumbMcp, 0.5);
  const thumbIp = lerpPoint(spec.thumbMcp, spec.thumbTip, 0.5);
  points[LandmarkIndex.THUMB_CMC] = thumbCmc;
  points[LandmarkIndex.THUMB_MCP] = spec.thumbMcp;
  points[LandmarkIndex.THUMB_IP] = thumbIp;
  points[LandmarkIndex.THUMB_TIP] = spec.thumbTip;

  const fingers: Array<[FingerEndpoints, LandmarkIndex, LandmarkIndex, LandmarkIndex, LandmarkIndex]> = [
    [
      spec.index,
      LandmarkIndex.INDEX_FINGER_MCP,
      LandmarkIndex.INDEX_FINGER_PIP,
      LandmarkIndex.INDEX_FINGER_DIP,
      LandmarkIndex.INDEX_FINGER_TIP,
    ],
    [
      spec.middle,
      LandmarkIndex.MIDDLE_FINGER_MCP,
      LandmarkIndex.MIDDLE_FINGER_PIP,
      LandmarkIndex.MIDDLE_FINGER_DIP,
      LandmarkIndex.MIDDLE_FINGER_TIP,
    ],
    [
      spec.ring,
      LandmarkIndex.RING_FINGER_MCP,
      LandmarkIndex.RING_FINGER_PIP,
      LandmarkIndex.RING_FINGER_DIP,
      LandmarkIndex.RING_FINGER_TIP,
    ],
    [spec.pinky, LandmarkIndex.PINKY_MCP, LandmarkIndex.PINKY_PIP, LandmarkIndex.PINKY_DIP, LandmarkIndex.PINKY_TIP],
  ];

  for (const [endpoints, mcpIdx, pipIdx, dipIdx, tipIdx] of fingers) {
    points[mcpIdx] = endpoints.mcp;
    points[pipIdx] = lerpPoint(endpoints.mcp, endpoints.tip, 0.5);
    points[dipIdx] = lerpPoint(endpoints.mcp, endpoints.tip, 0.75);
    points[tipIdx] = endpoints.tip;
  }

  return points;
}

const WRIST: Landmark = { x: 0.5, y: 0.9, z: 0 };

const MCPS = {
  index: { x: 0.45, y: 0.6, z: 0 },
  middle: { x: 0.5, y: 0.58, z: 0 },
  ring: { x: 0.55, y: 0.6, z: 0 },
  pinky: { x: 0.6, y: 0.62, z: 0 },
  thumb: { x: 0.38, y: 0.68, z: 0 },
};

/** Quatro dedos estendidos e polegar afastado — deve reconhecer como OPEN_PALM. */
export function openPalmLandmarks(): Landmark[] {
  return buildLandmarks({
    wrist: WRIST,
    thumbMcp: MCPS.thumb,
    thumbTip: { x: 0.25, y: 0.65, z: 0 },
    index: { mcp: MCPS.index, tip: { x: 0.45, y: 0.25, z: 0 } },
    middle: { mcp: MCPS.middle, tip: { x: 0.5, y: 0.2, z: 0 } },
    ring: { mcp: MCPS.ring, tip: { x: 0.55, y: 0.25, z: 0 } },
    pinky: { mcp: MCPS.pinky, tip: { x: 0.6, y: 0.35, z: 0 } },
  });
}

/** Quatro dedos recolhidos e polegar junto à palma — deve reconhecer como CLOSED_FIST. */
export function closedFistLandmarks(): Landmark[] {
  return buildLandmarks({
    wrist: WRIST,
    thumbMcp: MCPS.thumb,
    thumbTip: { x: 0.52, y: 0.72, z: 0 },
    index: { mcp: MCPS.index, tip: { x: 0.46, y: 0.62, z: 0 } },
    middle: { mcp: MCPS.middle, tip: { x: 0.5, y: 0.6, z: 0 } },
    ring: { mcp: MCPS.ring, tip: { x: 0.54, y: 0.62, z: 0 } },
    pinky: { mcp: MCPS.pinky, tip: { x: 0.59, y: 0.64, z: 0 } },
  });
}

/** Indicador estendido e os outros três recolhidos — deve reconhecer como POINTING. */
export function pointingLandmarks(): Landmark[] {
  return buildLandmarks({
    wrist: WRIST,
    thumbMcp: MCPS.thumb,
    thumbTip: { x: 0.52, y: 0.72, z: 0 },
    index: { mcp: MCPS.index, tip: { x: 0.45, y: 0.25, z: 0 } },
    middle: { mcp: MCPS.middle, tip: { x: 0.5, y: 0.6, z: 0 } },
    ring: { mcp: MCPS.ring, tip: { x: 0.54, y: 0.62, z: 0 } },
    pinky: { mcp: MCPS.pinky, tip: { x: 0.59, y: 0.64, z: 0 } },
  });
}

/** Ponta do polegar junto à do indicador, demais dedos recolhidos — distância de pinça próxima de 0. */
export function pinchLandmarks(): Landmark[] {
  return buildLandmarks({
    wrist: WRIST,
    thumbMcp: MCPS.thumb,
    thumbTip: { x: 0.435, y: 0.505, z: 0 },
    index: { mcp: MCPS.index, tip: { x: 0.43, y: 0.5, z: 0 } },
    middle: { mcp: MCPS.middle, tip: { x: 0.5, y: 0.6, z: 0 } },
    ring: { mcp: MCPS.ring, tip: { x: 0.54, y: 0.62, z: 0 } },
    pinky: { mcp: MCPS.pinky, tip: { x: 0.59, y: 0.64, z: 0 } },
  });
}
