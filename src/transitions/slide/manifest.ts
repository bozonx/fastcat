import { Filter, GlProgram, Texture } from 'pixi.js';
import { easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface SlideParams {
  softness?: number;
}

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform mat3 uFilterMatrix;

void main(void) {
  gl_Position = vec4(aPosition * 2.0 - 1.0, 0.0, 1.0);
  vTextureCoord = (uFilterMatrix * vec3(aPosition, 1.0)).xy;
}
`;

const fragment = `
in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform sampler2D uFromTexture;
uniform float uProgress;
uniform float uSoftness;

void main(void) {
  vec2 uv = vec2(vTextureCoord.x, 1.0 - vTextureCoord.y);
  float progress = clamp(uProgress, 0.0, 1.0);
  float softness = max(0.0001, uSoftness);

  vec2 fromUv = vec2(uv.x - progress, uv.y);
  vec2 toUv = vec2(uv.x + (1.0 - progress), uv.y);

  vec4 fromColor = texture(uFromTexture, fromUv);
  vec4 toColor = texture(uTexture, toUv);

  float fromMask = 1.0 - smoothstep(1.0 - softness, 1.0, uv.x + progress);
  float toMask = 1.0 - smoothstep(softness, 0.0, uv.x - (1.0 - progress));

  gl_FragColor = fromColor * fromMask + toColor * toMask;
}
`;

export const slideManifest: TransitionManifest<SlideParams> = {
  type: 'slide',
  name: 'Slide',
  icon: 'i-heroicons-arrows-right-left',
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
        slideUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uSoftness: { value: 0.02, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.slideUniforms?.uniforms;
    if (!uniforms) return;
    const progress =
      context.curve === 'bezier' ? easeInOutCubic(context.progress) : context.progress;
    const softnessRaw = Number((context.params as SlideParams | undefined)?.softness ?? 0.02);
    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uSoftness = Math.max(
      0.0001,
      Math.min(0.2, Number.isFinite(softnessRaw) ? softnessRaw : 0.02),
    );
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
