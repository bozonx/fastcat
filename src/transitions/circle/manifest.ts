import { Filter, GlProgram, Texture } from 'pixi.js';
import { easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface CircleParams {
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

void main(void) {
  vec2 centered = vTextureCoord - vec2(0.5, 0.5);
  float distanceFromCenter = length(centered);
  float maxRadius = 0.70710678;
  float progress = clamp(uProgress, 0.0, 1.0);
  float softness = max(0.0001, uSoftness);
  float radius = progress * maxRadius;
  float reveal = 1.0 - smoothstep(radius - softness, radius + softness, distanceFromCenter);

  vec4 fromColor = texture(uFromTexture, vTextureCoord);
  vec4 toColor = texture(uTexture, vTextureCoord);

  gl_FragColor = mix(fromColor, toColor, reveal);
}
`;

export const circleManifest: TransitionManifest<CircleParams> = {
  type: 'circle',
  name: 'Circle',
  icon: 'i-heroicons-stop-circle',
  defaultDurationUs: 600_000,
  defaultParams: {
    softness: 0.015,
  },
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        circleUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uSoftness: { value: 0.015, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.circleUniforms?.uniforms;
    if (!uniforms) return;
    const progress =
      context.curve === 'bezier' ? easeInOutCubic(context.progress) : context.progress;
    const softnessRaw = Number((context.params as CircleParams | undefined)?.softness ?? 0.015);
    if (context.fromTexture?.source) {
      resources.uFromTexture = context.fromTexture.source;
    }
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uSoftness = Math.max(
      0.0001,
      Math.min(0.15, Number.isFinite(softnessRaw) ? softnessRaw : 0.015),
    );
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
