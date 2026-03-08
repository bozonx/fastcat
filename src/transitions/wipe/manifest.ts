import { Filter, GlProgram, Texture } from 'pixi.js';
import {
  applyTransitionCurve,
  clampNumber,
  hexColorToRgb01,
  sanitizeTransitionColor,
} from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface WipeParams {
  direction: 'left' | 'right' | 'up' | 'down';
  edgeMode: 'gap' | 'blur';
  gap: number;
  gapColor: string;
  blur: number;
  angle: number;
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
uniform float uGap;
uniform float uBlur;
uniform float uUseGap;
uniform float uApplyToEdgeBlur;
uniform vec2 uAxis;
uniform vec3 uGapColor;
uniform float uAspect;

out vec4 finalColor;
void main(void) {
  vec2 uv = vNormalizedCoord;
  vec4 fromColor = texture(uFromTexture, uv);
  vec4 toColor = texture(uTexture, vTextureCoord);

  vec2 p = (uv - vec2(0.5, 0.5)) * vec2(uAspect, 1.0);

  float progress = clamp(uProgress, 0.0, 1.0);
  vec2 axis = normalize(uAxis);
  float gapHalf = uGap * 0.5;
  float maxDist = 0.5 * (uAspect * abs(axis.x) + abs(axis.y));
  float axisValue = dot(p, axis);
  float edge = mix(-maxDist - gapHalf, maxDist + gapHalf, progress);
  float cutStart = edge - gapHalf;
  float cutEnd = edge + gapHalf;
  float blur = max(uBlur, 0.00001);
  float blurMix = smoothstep(edge - blur, edge + blur, axisValue);

  if (uUseGap < 0.5) {
    vec4 mixedColor = mix(toColor, fromColor, blurMix);
    if (uApplyToEdgeBlur > 0.5) {
      finalColor = mixedColor;
    } else {
      finalColor = axisValue < edge ? toColor : fromColor;
    }
    return;
  }

  if (axisValue < cutStart) {
    finalColor = toColor;
    return;
  }

  if (axisValue > cutEnd) {
    finalColor = fromColor;
    return;
  }

  finalColor = vec4(uGapColor, 1.0);
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
  const edgeMode = params?.edgeMode === 'blur' ? 'blur' : 'gap';

  return {
    direction,
    edgeMode,
    gap: clampNumber(params?.gap, 0, 0.2, 0.02),
    gapColor: sanitizeTransitionColor(params?.gapColor, '#000000'),
    blur: clampNumber(params?.blur, 0.0001, 0.2, 0.02),
    angle: clampNumber(params?.angle, -180, 180, 0),
  };
}

function getDirectionVector(direction: WipeParams['direction']): { x: number; y: number } {
  switch (direction) {
    case 'right':
      return { x: 1, y: 0 };
    case 'up':
      return { x: 0, y: -1 };
    case 'down':
      return { x: 0, y: 1 };
    case 'left':
    default:
      return { x: -1, y: 0 };
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
      key: 'edgeMode',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramWipeEdgeMode',
      options: [
        { value: 'gap', labelKey: 'granVideoEditor.timeline.transition.wipeEdgeModeGap' },
        { value: 'blur', labelKey: 'granVideoEditor.timeline.transition.wipeEdgeModeBlur' },
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
    {
      key: 'blur',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramWipeEdgeBlur',
      min: 0.0001,
      max: 0.2,
      step: 0.005,
    },
    {
      key: 'angle',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramAngle',
      min: -180,
      max: 180,
      step: 1,
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
          uBlur: { value: 0.02, type: 'f32' },
          uUseGap: { value: 1, type: 'f32' },
          uApplyToEdgeBlur: { value: 0, type: 'f32' },
          uAxis: { value: [1, 0], type: 'vec2<f32>' },
          uGapColor: { value: [0, 0, 0], type: 'vec3<f32>' },
          uAspect: { value: 1.0, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.wipeUniforms?.uniforms;
    if (!uniforms) return;
    const progress = applyTransitionCurve(context.progress, context.curve);
    const params = normalizeWipeParams(context.params);
    const baseAxis = getDirectionVector(params.direction);
    const angleRad = params.angle * (Math.PI / 180);
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const axisX = baseAxis.x * cosA - baseAxis.y * sinA;
    const axisY = baseAxis.x * sinA + baseAxis.y * cosA;
    const rgb = hexColorToRgb01(params.gapColor);
    const useGap = params.edgeMode === 'gap';
    const aspect = context.toTexture ? context.toTexture.width / context.toTexture.height : 16 / 9;

    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uGap = useGap ? params.gap : 0;
    uniforms.uBlur = params.blur;
    uniforms.uUseGap = useGap ? 1 : 0;
    uniforms.uApplyToEdgeBlur = !useGap && context.edge === 'in' ? 1 : 0;
    uniforms.uAxis = [axisX, axisY];
    uniforms.uGapColor = [rgb.r, rgb.g, rgb.b];
    uniforms.uAspect = aspect;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
