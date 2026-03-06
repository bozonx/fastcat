import { Filter, GlProgram, Texture } from 'pixi.js';
import { easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface ClockParams {
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

const float PI = 3.1415926535897932384626433832795;

void main(void) {
  vec2 centered = vTextureCoord - vec2(0.5, 0.5);
  float angle = atan(centered.y, centered.x) + PI * 0.5;
  if (angle < 0.0) {
    angle += PI * 2.0;
  }

  float normalizedAngle = angle / (PI * 2.0);
  float progress = clamp(uProgress, 0.0, 1.0);
  float softness = max(0.0001, uSoftness);
  float reveal = smoothstep(progress - softness, progress + softness, normalizedAngle);

  vec4 fromColor = texture(uFromTexture, vTextureCoord);
  vec4 toColor = texture(uTexture, vTextureCoord);

  gl_FragColor = mix(fromColor, toColor, 1.0 - reveal);
}
`;

export const clockManifest: TransitionManifest<ClockParams> = {
  type: 'clock',
  name: 'Clock',
  icon: 'i-heroicons-clock',
  defaultDurationUs: 600_000,
  defaultParams: {
    softness: 0.01,
  },
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        clockUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uSoftness: { value: 0.01, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.clockUniforms?.uniforms;
    if (!uniforms) return;
    const progress =
      context.curve === 'bezier' ? easeInOutCubic(context.progress) : context.progress;
    const softnessRaw = Number((context.params as ClockParams | undefined)?.softness ?? 0.01);
    if (context.fromTexture?.source) {
      resources.uFromTexture = context.fromTexture.source;
    }
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uSoftness = Math.max(
      0.0001,
      Math.min(0.1, Number.isFinite(softnessRaw) ? softnessRaw : 0.01),
    );
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
