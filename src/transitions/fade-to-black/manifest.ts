import { Filter, GlProgram, Texture } from 'pixi.js';
import { easeInOutCubic, hexColorToRgb01, sanitizeTransitionColor } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface FadeToBlackParams {
  color: string;
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
uniform vec3 uFadeColor;

void main(void) {
  vec2 uv = vec2(vTextureCoord.x, 1.0 - vTextureCoord.y);
  vec4 fromColor = texture(uFromTexture, uv);
  vec4 toColor = texture(uTexture, uv);
  float progress = clamp(uProgress, 0.0, 1.0);
  vec4 fadeColor = vec4(uFadeColor, 1.0);

  if (progress < 0.5) {
    float local = progress * 2.0;
    gl_FragColor = mix(fromColor, fadeColor, local);
    return;
  }

  float local = (progress - 0.5) * 2.0;
  gl_FragColor = mix(fadeColor, toColor, local);
}
`;

function normalizeFadeToBlackParams(params?: Record<string, unknown>): FadeToBlackParams {
  return {
    color: sanitizeTransitionColor(params?.color, '#000000'),
  };
}

export const fadeToBlackManifest: TransitionManifest<FadeToBlackParams> = {
  type: 'fade-to-black',
  name: 'Fade to Black',
  icon: 'i-heroicons-moon',
  defaultDurationUs: 500_000,
  defaultParams: normalizeFadeToBlackParams(),
  normalizeParams: normalizeFadeToBlackParams,
  paramFields: [
    {
      key: 'color',
      kind: 'color',
      labelKey: 'granVideoEditor.timeline.transition.paramFadeColor',
    },
  ],
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        fadeToBlackUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uFadeColor: { value: [0, 0, 0], type: 'vec3<f32>' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.fadeToBlackUniforms?.uniforms;
    if (!uniforms) return;
    const params = normalizeFadeToBlackParams(context.params);
    const progress =
      context.curve === 'bezier' ? easeInOutCubic(context.progress) : context.progress;
    const rgb = hexColorToRgb01(params.color);
    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uFadeColor = [rgb.r, rgb.g, rgb.b];
  },
  computeOutOpacity: (progress, _params, curve) => {
    const p = curve === 'bezier' ? easeInOutCubic(progress) : progress;
    if (p < 0.5) {
      return 1 - p * 2;
    }
    return 0;
  },
  computeInOpacity: (progress, _params, curve) => {
    const p = curve === 'bezier' ? easeInOutCubic(progress) : progress;
    if (p < 0.5) {
      return 0;
    }
    return (p - 0.5) * 2;
  },
};
