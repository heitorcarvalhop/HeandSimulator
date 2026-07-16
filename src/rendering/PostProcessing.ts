import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Compõe a cena transparente com bloom opcional, preservando o alpha para a webcam aparecer atrás. */
export class PostProcessing {
  readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly alphaRestorePass: ShaderPass;
  private bloomEnabled = true;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
    });

    this.composer = new EffectComposer(renderer, renderTarget);
    this.composer.renderToScreen = true;

    const renderPass = new RenderPass(scene, camera);
    renderPass.clearAlpha = 0;
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.9, 0.6, 0.15);
    this.composer.addPass(this.bloomPass);

    // O UnrealBloomPass compõe sobre um fundo preto opaco, destruindo o alpha.
    // Este passe restaura o alpha a partir da renderização original da cena.
    this.alphaRestorePass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, tScene: { value: renderTarget.texture } },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform sampler2D tScene;
          varying vec2 vUv;
          void main() {
            vec4 bloomed = texture2D(tDiffuse, vUv);
            float alpha = texture2D(tScene, vUv).a;
            gl_FragColor = vec4(bloomed.rgb, alpha);
          }
        `,
      }),
      'tDiffuse',
    );
    this.alphaRestorePass.renderToScreen = true;
    this.composer.addPass(this.alphaRestorePass);
  }

  setBloomEnabled(enabled: boolean): void {
    this.bloomEnabled = enabled;
    this.bloomPass.enabled = enabled;
  }

  isBloomEnabled(): boolean {
    return this.bloomEnabled;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
