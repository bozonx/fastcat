import { Filter, GlProgram, Texture } from 'pixi.js';
import {
  clampNumber,
  easeInOutCubic,
  hexColorToRgb01,
  sanitizeTransitionColor,
} from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface WipeParams {
  direction: 'left' | 'right' | 'up' | 'down';
  gap: number;
  gapColor: string;
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
uniform float uGap;
uniform vec2 uAxis;
uniform vec2 uResolution;
uniform vec3 uGapColor;

void main(void) {
  vec2 uv = vTextureCoord;
  vec4 fromColor = texture(uFromTexture, uv);
  vec4 toColor = texture(uTexture, uv);
  float progress = clamp(uProgress, 0.0, 1.0);
  vec2 axis = normalize(uAxis);
  vec2 resolution = max(uResolution, vec2(1.0, 1.0));
  float minResolution = max(1.0, min(resolution.x, resolution.y));
  vec2 aspectScale = vec2(minResolution / resolution.x, minResolution / resolution.y);
  float gapHalf = uGap * 0.5;
  float axisValue = dot(uv - vec2(0.5, 0.5), axis);
  float edge = mix(-0.5 - gapHalf, 0.5 + gapHalf, progress);
  float cutStart = edge - gapHalf;
  float cutEnd = edge + gapHalf;

  if (axisValue < cutStart) {
    gl_FragColor = fromColor;
    return;
  }

  if (axisValue > cutEnd) {
    gl_FragColor = toColor;
    return;
  }

  gl_FragColor = vec4(uGapColor, 1.0);
}
`;

function normalizeWipeParams(params?: Record<string, unknown>): WipeParams {
  const direction =
    params?.direction === 'right' ||
    params?.direction === 'up' ||
    params?.direction === 'down' ||
    params?.direction === 'left'
      ? params.direction
      : 'left';

  return {
    direction,
    gap: clampNumber(params?.gap, 0, 0.2, 0.02),
    gapColor: sanitizeTransitionColor(params?.gapColor, '#000000'),
  };
}

function getDirectionVector(direction: WipeParams['direction']): { x: number; y: number } {
  switch (direction) {
    case 'right':
      return { x: -1, y: 0 };
    case 'up':
      return { x: 0, y: 1 };
    case 'down':
      return { x: 0, y: -1 };
    case 'left':
    default:
      return { x: 1, y: 0 };
  }
}

export const wipeManifest: TransitionManifest<WipeParams> = {
  type: 'wipe',
  name: 'Wipe',
  icon: 'i-heroicons-bars-3-bottom-left',
  defaultDurationUs: 500_000,
  defaultParams: normalizeWipeParams(),
  normalizeParams: normalizeWipeParams,
  paramFields: [
    {
      key: 'direction',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramDirection',
      options: [
        { value: 'left', labelKey: 'granVideoEditor.timeline.transition.directionLeft' },
        { value: 'right', labelKey: 'granVideoEditor.timeline.transition.directionRight' },
        { value: 'up', labelKey: 'granVideoEditor.timeline.transition.directionUp' },
        { value: 'down', labelKey: 'granVideoEditor.timeline.transition.directionDown' },
      ],
    },
    {
      key: 'gap',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramGapSize',
      min: 0,
      max: 0.2,
      step: 0.005,
    },
    {
      key: 'gapColor',
      kind: 'color',
      labelKey: 'granVideoEditor.timeline.transition.paramGapColor',
    },
  ],
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        wipeUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uGap: { value: 0.02, type: 'f32' },
          uAxis: { value: [1, 0], type: 'vec2<f32>' },
          uResolution: { value: [1920, 1080], type: 'vec2<f32>' },
          uGapColor: { value: [0, 0, 0], type: 'vec3<f32>' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.wipeUniforms?.uniforms;
    if (!uniforms) return;
    const progress =
      context.curve === 'bezier' ? easeInOutCubic(context.progress) : context.progress;
    const params = normalizeWipeParams(context.params);
    const axis = getDirectionVector(params.direction);
    const rgb = hexColorToRgb01(params.gapColor);
    const width = Number(
      (context.toTexture as any)?.source?.width ??
        (context.fromTexture as any)?.source?.width ??
        1920,
    );
    const height = Number(
      (context.toTexture as any)?.source?.height ??
        (context.fromTexture as any)?.source?.height ??
        1080,
    );
    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uGap = params.gap;
    uniforms.uAxis = [axis.x, axis.y];
    uniforms.uResolution = [Math.max(1, width), Math.max(1, height)];
    uniforms.uGapColor = [rgb.r, rgb.g, rgb.b];
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
