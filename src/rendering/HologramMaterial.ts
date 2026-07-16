import * as THREE from 'three';

export interface HologramUniforms {
  uTime: { value: number };
  uPulseSpeed: { value: number };
  uScanSpeed: { value: number };
  uRimPower: { value: number };
  uRimIntensity: { value: number };
  uGridDivisions: { value: number };
}

export interface HologramMaterialHandle {
  material: THREE.MeshStandardMaterial;
  uniforms: HologramUniforms;
}

/**
 * MeshStandardMaterial com aparência holográfica via onBeforeCompile (brilho de borda,
 * scanline, grade interna e pulso), mantendo iluminação, transparência e instancing nativos.
 */
export function createHologramMaterial(baseColor = new THREE.Color(0x1adfff)): HologramMaterialHandle {
  const uniforms: HologramUniforms = {
    uTime: { value: 0 },
    uPulseSpeed: { value: 1.4 },
    uScanSpeed: { value: 0.6 },
    uRimPower: { value: 2.2 },
    uRimIntensity: { value: 1.6 },
    uGridDivisions: { value: 4.0 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: baseColor,
    emissive: baseColor.clone(),
    emissiveIntensity: 0.9,
    transparent: true,
    opacity: 0.55,
    metalness: 0.1,
    roughness: 0.25,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    // vLocalPos leva a posição local do cubo (~[-0.5, 0.5]) até o fragment shader,
    // usada abaixo para gerar a scanline e a grade interna proceduralmente.
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vLocalPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vLocalPos = position;`,
      );

    // O brilho de borda (fresnel) é calculado uma vez no início do shader e reaproveitado
    // pelos trechos de alpha e emissivo mais abaixo.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uPulseSpeed;
        uniform float uScanSpeed;
        uniform float uRimPower;
        uniform float uRimIntensity;
        uniform float uGridDivisions;
        varying vec3 vLocalPos;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        vec3 hologramViewNormal = normalize(vNormal);
        vec3 hologramViewDir = normalize(vViewPosition);
        float hologramRim = pow(1.0 - clamp(dot(hologramViewNormal, hologramViewDir), 0.0, 1.0), uRimPower);`,
      )
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
        diffuseColor.a *= mix(0.45, 1.0, hologramRim);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>

        totalEmissiveRadiance += emissive * hologramRim * uRimIntensity;

        float pulse = 0.75 + 0.25 * sin(uTime * uPulseSpeed);
        totalEmissiveRadiance *= pulse;

        float scan = fract(vLocalPos.y * 1.5 - uTime * uScanSpeed);
        float scanLine = smoothstep(0.0, 0.02, scan) * smoothstep(0.08, 0.02, scan);
        totalEmissiveRadiance += emissive * scanLine * 1.2;

        vec3 gridCoord = fract(vLocalPos * uGridDivisions);
        float gridLine = 1.0 - step(0.04, min(min(gridCoord.x, gridCoord.y), gridCoord.z));
        totalEmissiveRadiance += emissive * gridLine * 0.25;`,
      );
  };

  material.customProgramCacheKey = () => 'hologram-voxel-material';

  return { material, uniforms };
}

/** Material de linha para as arestas em lote; a cor vem por vértice (ciano/amarelo/vermelho). */
export function createEdgeMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/** Material de linha de cor sólida para os wireframes de prévia. */
export function createPreviewLineMaterial(color: THREE.Color): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
