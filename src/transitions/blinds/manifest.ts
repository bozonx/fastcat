import { Filter, GlProgram, Texture } from 'pixi.js';
import { applyTransitionCurve, clampNumber } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface BlindsParams {
  direction: 'horizontal' | 'vertical';
  stripCount: number;
  motionBlur: number;
}

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vNormalizedCoord;
out vec2 vTexScale;

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
  vTexScale = uOutputFrame.zw * uInputSize.zw;
}
`;

const fragment = `
in vec2 vTextureCoord;
in vec2 vNormalizedCoord;
in vec2 vTexScale;

uniform sampler2D uTexture;
uniform sampler2D uFromTexture;
uniform float uProgress;
uniform vec2 uAxis;
uniform float uStripCount;
uniform float uMotionBlur;

vec4 getColor(vec2 uv) {
  // If uAxis is (1,0), movement is horizontal, strips are separated by Y.
  // If uAxis is (0,1), movement is vertical, strips are separated by X.
  float stripCoord = (uAxis.x > 0.5) ? uv.y : uv.x;
  float stripIndex = floor(stripCoord * uStripCount);
  float dir = mod(stripIndex, 2.0) == 0.0 ? 1.0 : -1.0;
  vec2 moveVec = uAxis * dir;

  vec2 fromUv = uv - moveVec * uProgress;
  vec2 toUv = uv - moveVec * (uProgress - 1.0);

  float fromInside = step(0.0, fromUv.x) * step(fromUv.x, 1.0) * step(0.0, fromUv.y) * step(fromUv.y, 1.0);
  float toInside = step(0.0, toUv.x) * step(toUv.x, 1.0) * step(0.0, toUv.y) * step(toUv.y, 1.0);

  if (fromInside > 0.5) {
    return texture(uFromTexture, fromUv);
  } else if (toInside > 0.5) {
    return texture(uTexture, toUv * vTexScale);
  } else {
    return vec4(0.0, 0.0, 0.0, 1.0); // Black background if neither
  }
}

out vec4 finalColor;
void main(void) {
  if (uMotionBlur <= 0.0) {
    finalColor = getColor(vNormalizedCoord);
    return;
  }

  const int SAMPLES = 16;
  vec4 accumColor = vec4(0.0);
  
  float stepSize = uMotionBlur / float(SAMPLES - 1);
  float startOffset = -uMotionBlur * 0.5;

  float stripCoord = (uAxis.x > 0.5) ? vNormalizedCoord.y : vNormalizedCoord.x;
  float stripIndex = floor(stripCoord * uStripCount);
  float dir = mod(stripIndex, 2.0) == 0.0 ? 1.0 : -1.0;
  vec2 blurAxis = uAxis * dir;

  for (int i = 0; i < SAMPLES; i++) {
    float offset = startOffset + float(i) * stepSize;
    vec2 sampleUv = vNormalizedCoord + blurAxis * offset;
    accumColor += getColor(sampleUv);
  }

  finalColor = accumColor / float(SAMPLES);
}
`;

function normalizeBlindsParams(params?: Record<string, unknown>): BlindsParams {
  const direction = params?.direction === 'vertical' ? 'vertical' : 'horizontal';
  return {
    direction,
    stripCount: Math.round(clampNumber(params?.stripCount, 2, 100, 10)),
    motionBlur: clampNumber(params?.motionBlur, 0, 10, 0),
  };
}

export const blindsManifest: TransitionManifest<BlindsParams> = {
  type: 'blinds',
  name: 'Blinds',
  icon: 'i-heroicons-bars-3',
  defaultDurationUs: 1_000_000,
  defaultParams: normalizeBlindsParams(),
  normalizeParams: normalizeBlindsParams,
  paramFields: [
    {
      key: 'direction',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramDirection',
      options: [
        { value: 'horizontal', labelKey: 'granVideoEditor.timeline.transition.directionHorizontal' },
        { value: 'vertical', labelKey: 'granVideoEditor.timeline.transition.directionVertical' },
      ],
    },
    {
      key: 'stripCount',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramStripCount',
      min: 2,
      max: 100,
      step: 1,
    },
    {
      key: 'motionBlur',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramMotionBlur',
      min: 0,
      max: 10,
      step: 0.01,
    },
  ],
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        blindsUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uAxis: { value: [1, 0], type: 'vec2<f32>' },
          uStripCount: { value: 10, type: 'f32' },
          uMotionBlur: { value: 0, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.blindsUniforms?.uniforms;
    if (!uniforms) return;
    
    const progress = applyTransitionCurve(context.progress, context.curve);
    const params = normalizeBlindsParams(context.params);
    const axis = params.direction === 'vertical' ? { x: 0, y: 1 } : { x: 1, y: 0 };

    const deltaProgress = 0.01;
    const p1 = applyTransitionCurve(Math.max(0, context.progress - deltaProgress), context.curve);
    const p2 = applyTransitionCurve(Math.min(1, context.progress + deltaProgress), context.curve);
    const speedMultiplier = (p2 - p1) / (2 * deltaProgress);

    let blurAmount = 0;
    if (params.motionBlur > 0 && context.durationUs && context.durationUs > 0) {
      const durationSeconds = context.durationUs / 1_000_000;
      const baseSpeed = 1.0 / durationSeconds;
      let targetBlur = baseSpeed * params.motionBlur * 0.05 * speedMultiplier;
      blurAmount = Math.max(0, targetBlur);
    }

    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uAxis = [axis.x, axis.y];
    uniforms.uStripCount = params.stripCount;
    uniforms.uMotionBlur = blurAmount;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
