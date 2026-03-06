import { Filter, GlProgram, Texture } from 'pixi.js';
import { easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface WipeParams {
  softness?: number;
}

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;

void main(void) {
  gl_Position = vec4(aPosition * 2.0 - 1.0, 0.0, 1.0);
  vTextureCoord = aPosition;
}
`;

const fragment = `
in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform sampler2D uFromTexture;
uniform float uProgress;
uniform float uSoftness;
uniform float uDirection;

void main(void) {
  vec4 fromColor = texture(uFromTexture, vTextureCoord);
  vec4 toColor = texture(uTexture, vTextureCoord);
  float progress = clamp(uProgress, 0.0, 1.0);
  float softness = max(0.0001, uSoftness);
  float edge = uDirection > 0.5 ? progress : (1.0 - progress);
  float axis = uDirection > 0.5 ? vTextureCoord.x : (1.0 - vTextureCoord.x);
  float mixValue = smoothstep(edge - softness, edge + softness, axis);
  gl_FragColor = mix(fromColor, toColor, mixValue);
}
`;

export const wipeManifest: TransitionManifest<WipeParams> = {
  type: 'wipe',
  name: 'Wipe',
  icon: 'i-heroicons-bars-3-bottom-left',
  defaultDurationUs: 500_000,
  defaultParams: {
    softness: 0.02,
  },
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        wipeUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uSoftness: { value: 0.02, type: 'f32' },
          uDirection: { value: 1, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.wipeUniforms?.uniforms;
    if (!uniforms) return;
    const progress =
      context.curve === 'bezier' ? easeInOutCubic(context.progress) : context.progress;
    const softnessRaw = Number((context.params as WipeParams | undefined)?.softness ?? 0.02);
    if (context.fromTexture?.source) {
      resources.uFromTexture = context.fromTexture.source;
    }
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uSoftness = Math.max(
      0.0001,
      Math.min(0.5, Number.isFinite(softnessRaw) ? softnessRaw : 0.02),
    );
    uniforms.uDirection = 1;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
