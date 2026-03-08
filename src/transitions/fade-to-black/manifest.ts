import { Filter, GlProgram, Texture } from 'pixi.js';
import { easeInOutCubic, hexColorToRgb01, sanitizeTransitionColor } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface FadeToBlackParams {
  color: string;
  mode: 'dip' | 'crossfade';
}

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vNormalizedCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void) {
  return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
  vNormalizedCoord = aPosition;
}
`;

const fragment = `
in vec2 vTextureCoord;
in vec2 vNormalizedCoord;

uniform sampler2D uTexture;
uniform sampler2D uFromTexture;
uniform float uProgress;
uniform vec3 uFadeColor;
uniform int uMode;

void main(void) {
  vec2 uv = vNormalizedCoord;
  vec4 fromColor = texture(uFromTexture, uv);
  vec4 toColor = texture(uTexture, vTextureCoord);
  float progress = clamp(uProgress, 0.0, 1.0);
  vec4 fadeColor = vec4(uFadeColor, 1.0);

  if (uMode == 0) {
    if (progress < 0.5) {
      float local = progress * 2.0;
      gl_FragColor = mix(fromColor, fadeColor, local);
      return;
    }

    float local = (progress - 0.5) * 2.0;
    gl_FragColor = mix(fadeColor, toColor, local);
  } else {
    // Crossfade mode: smooth dissolve across the entire duration without a midpoint stop,
    // but simultaneously darken towards zero brightness
    vec4 mixedColor = mix(fromColor, toColor, progress);
    float brightness = 1.0 - progress; // Linear decrease to 0
    gl_FragColor = vec4(mixedColor.rgb * brightness, mixedColor.a);
  }
}
`;

function normalizeFadeToBlackParams(params?: Record<string, unknown>): FadeToBlackParams {
  return {
    color: sanitizeTransitionColor(params?.color, '#000000'),
    mode: params?.mode === 'crossfade' ? 'crossfade' : 'dip',
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
      key: 'mode',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramFadeMode',
      options: [
        { value: 'dip', labelKey: 'granVideoEditor.timeline.transition.fadeModeDip' },
        { value: 'crossfade', labelKey: 'granVideoEditor.timeline.transition.fadeModeCrossfade' },
      ],
    },
    {
      key: 'color',
      kind: 'color',
      labelKey: 'granVideoEditor.timeline.transition.paramFadeColor',
      showIf: (params) => params.mode !== 'crossfade',
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
          uMode: { value: 0, type: 'i32' },
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
    uniforms.uMode = params.mode === 'crossfade' ? 1 : 0;
  },
  computeOutOpacity: () => {
    // In both modes, the background under the fade should never be transparent.
    // We let the shader handle the full transition logic
    // so we return 1 (fully opaque) for the outgoing clip mask/shadow.
    return 1;
  },
  computeInOpacity: () => {
    return 1;
  },
};
