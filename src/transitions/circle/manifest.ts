import { Filter, GlProgram, Texture } from 'pixi.js';
import { clampNumber, easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface CircleParams {
  blur: number;
  direction: 'from-center' | 'to-center';
}

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;

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
}
`;

const fragment = `
in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform sampler2D uFromTexture;
uniform float uProgress;
uniform float uBlur;
uniform float uDirection;

void main(void) {
  vec2 uv = vTextureCoord;
  vec2 centered = uv - vec2(0.5, 0.5);
  float distanceFromCenter = length(centered);
  float maxRadius = 0.70710678;
  float progress = clamp(uProgress, 0.0, 1.0);
  float blur = max(0.0001, uBlur);
  float radius = (uDirection > 0.0 ? progress : (1.0 - progress)) * maxRadius;
  float reveal = 1.0 - smoothstep(radius - blur, radius + blur, distanceFromCenter);

  if (uDirection < 0.0) {
    reveal = 1.0 - reveal;
  }

  vec4 fromColor = texture(uFromTexture, uv);
  vec4 toColor = texture(uTexture, uv);

  gl_FragColor = mix(fromColor, toColor, reveal);
}
`;

function normalizeCircleParams(params?: Record<string, unknown>): CircleParams {
  return {
    blur: clampNumber(params?.blur, 0.0001, 0.2, 0.015),
    direction: params?.direction === 'to-center' ? 'to-center' : 'from-center',
  };
}

export const circleManifest: TransitionManifest<CircleParams> = {
  type: 'circle',
  name: 'Circle',
  icon: 'i-heroicons-stop-circle',
  defaultDurationUs: 600_000,
  defaultParams: normalizeCircleParams(),
  normalizeParams: normalizeCircleParams,
  paramFields: [
    {
      key: 'blur',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramCircleBlur',
      min: 0.0001,
      max: 0.2,
      step: 0.0025,
    },
    {
      key: 'direction',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramDirection',
      options: [
        {
          value: 'from-center',
          labelKey: 'granVideoEditor.timeline.transition.directionFromCenter',
        },
        { value: 'to-center', labelKey: 'granVideoEditor.timeline.transition.directionToCenter' },
      ],
    },
  ],
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        circleUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uBlur: { value: 0.015, type: 'f32' },
          uDirection: { value: 1, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.circleUniforms?.uniforms;
    if (!uniforms) return;
    const progress =
      context.curve === 'bezier' ? easeInOutCubic(context.progress) : context.progress;
    const params = normalizeCircleParams(context.params);
    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uBlur = params.blur;
    uniforms.uDirection = params.direction === 'to-center' ? -1 : 1;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
