import { Filter, GlProgram, Texture } from 'pixi.js';
import { applyTransitionCurve, clampNumber } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface BlindsParams {
  angle: number;
  stripCount: number;
  blurType: 'motion' | 'post';
  motionBlur: number;
  motionBlurMode: 'normal' | 'bloom';
  brightnessMode: 'normal' | 'bloom';
  brightness: number;
  bloomThreshold: number;
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
uniform vec2 uPerp;
uniform float uStripCount;
uniform float uBlurType;
uniform float uMotionBlur;
uniform float uMotionBlurMode;
uniform float uBrightnessMode;
uniform float uBrightness;
uniform float uBloomThreshold;

vec4 getColor(vec2 uv) {
  float stripCoord = dot(uv - 0.5, uPerp) + 0.5;
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

vec4 processSample(vec4 color) {
  float extra = 0.0;
  if (uBrightnessMode > 0.5) {
    float lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    float mask = smoothstep(uBloomThreshold, 1.0, lum);
    extra = uBrightness * mask;
  } else {
    extra = uBrightness;
  }
  return vec4(max(vec3(0.0), color.rgb * (1.0 + extra)), color.a);
}

out vec4 finalColor;
void main(void) {
  if (uMotionBlur <= 0.0) {
    finalColor = processSample(getColor(vNormalizedCoord));
    return;
  }

  const int SAMPLES = 16;
  vec4 accumColor = vec4(0.0);
  
  float stepSize = uMotionBlur / float(SAMPLES - 1);
  float startOffset = -uMotionBlur * 0.5;

  float stripCoord = dot(vNormalizedCoord - 0.5, uPerp) + 0.5;
  float stripIndex = floor(stripCoord * uStripCount);
  float dir = mod(stripIndex, 2.0) == 0.0 ? 1.0 : -1.0;
  
  // Use either the strip movement axis (motion blur) or simply spread around center (post blur)
  vec2 center = vec2(0.5, 0.5);
  vec2 blurAxis = uBlurType > 0.5 ? normalize(center - vNormalizedCoord) : (uAxis * dir);

  float totalWeight = 0.0;

  for (int i = 0; i < SAMPLES; i++) {
    float offset = startOffset + float(i) * stepSize;
    vec2 sampleUv = vNormalizedCoord + blurAxis * offset;
    vec4 color = processSample(getColor(sampleUv));

    float weight = 1.0;
    if (uMotionBlurMode > 0.5) {
      float lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      weight = smoothstep(uBloomThreshold, 1.0, lum);
    }
    
    accumColor += color * weight;
    totalWeight += weight;
  }

  if (totalWeight > 0.0) {
    finalColor = accumColor / totalWeight;
  } else {
    finalColor = processSample(getColor(vNormalizedCoord));
  }
}
`;

function normalizeBlindsParams(params?: Record<string, unknown>): BlindsParams {
  return {
    angle: clampNumber(params?.angle, -360, 360, 0),
    stripCount: Math.round(clampNumber(params?.stripCount, 2, 100, 10)),
    blurType: params?.blurType === 'post' ? 'post' : 'motion',
    motionBlur: clampNumber(params?.motionBlur, 0, 100, 0),
    motionBlurMode: params?.motionBlurMode === 'bloom' ? 'bloom' : 'normal',
    brightnessMode: params?.brightnessMode === 'bloom' ? 'bloom' : 'normal',
    brightness: clampNumber(params?.brightness, -10, 10, 0),
    bloomThreshold: clampNumber(params?.bloomThreshold, 0, 1, 0.7),
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
      key: 'angle',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramAngle',
      min: -360,
      max: 360,
      step: 1,
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
      key: 'blurType',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramBlurType',
      options: [
        { value: 'motion', labelKey: 'granVideoEditor.timeline.transition.blurTypeMotion' },
        { value: 'post', labelKey: 'granVideoEditor.timeline.transition.blurTypePost' },
      ],
    },
    {
      key: 'motionBlur',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramBlur',
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: 'motionBlurMode',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramMotionBlurMode',
      options: [
        { value: 'normal', labelKey: 'granVideoEditor.timeline.transition.motionBlurModeNormal' },
        { value: 'bloom', labelKey: 'granVideoEditor.timeline.transition.motionBlurModeBloom' },
      ],
    },
    {
      key: 'brightnessMode',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramBrightnessMode',
      options: [
        { value: 'normal', labelKey: 'granVideoEditor.timeline.transition.brightnessModeNormal' },
        { value: 'bloom', labelKey: 'granVideoEditor.timeline.transition.brightnessModeBloom' },
      ],
    },
    {
      key: 'brightness',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramBrightness',
      min: -10,
      max: 10,
      step: 0.1,
    },
    {
      key: 'bloomThreshold',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramBloomThreshold',
      min: 0,
      max: 1,
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
          uPerp: { value: [0, 1], type: 'vec2<f32>' },
          uStripCount: { value: 10, type: 'f32' },
          uBlurType: { value: 0, type: 'f32' },
          uMotionBlur: { value: 0, type: 'f32' },
          uMotionBlurMode: { value: 0, type: 'f32' },
          uBrightnessMode: { value: 0, type: 'f32' },
          uBrightness: { value: 0, type: 'f32' },
          uBloomThreshold: { value: 0.7, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.blindsUniforms?.uniforms;
    if (!uniforms) return;

    const progress = applyTransitionCurve(context.progress, context.curve);
    const params = normalizeBlindsParams(context.params);

    // Convert angle to radians
    // 0 degrees -> horizontal motion (axis = [1, 0])
    // 90 degrees -> vertical motion (axis = [0, 1])
    const rad = (params.angle * Math.PI) / 180;
    const axis = { x: Math.cos(rad), y: Math.sin(rad) };
    const perp = { x: -Math.sin(rad), y: Math.cos(rad) };

    const deltaProgress = 0.01;
    const p1 = applyTransitionCurve(Math.max(0, context.progress - deltaProgress), context.curve);
    const p2 = applyTransitionCurve(Math.min(1, context.progress + deltaProgress), context.curve);
    const speedMultiplier = (p2 - p1) / (2 * deltaProgress);

    let blurAmount = 0;
    if (params.blurType === 'motion') {
      if (params.motionBlur > 0 && context.durationUs && context.durationUs > 0) {
        const durationSeconds = context.durationUs / 1_000_000;
        const baseSpeed = 1.0 / durationSeconds;
        let targetBlur = baseSpeed * params.motionBlur * 0.05 * speedMultiplier;
        blurAmount = Math.max(0, targetBlur);
      }
    } else {
      // For post blur, we scale directly to make it noticeable similar to zoom transition
      blurAmount = params.motionBlur * 0.005;
    }

    const envelope = Math.sin(progress * Math.PI);
    const currentBrightness = params.brightness * envelope;

    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uAxis = [axis.x, axis.y];
    uniforms.uPerp = [perp.x, perp.y];
    uniforms.uStripCount = params.stripCount;
    uniforms.uBlurType = params.blurType === 'post' ? 1.0 : 0.0;
    uniforms.uMotionBlur = blurAmount;
    uniforms.uMotionBlurMode = params.motionBlurMode === 'bloom' ? 1.0 : 0.0;
    uniforms.uBrightnessMode = params.brightnessMode === 'bloom' ? 1.0 : 0.0;
    uniforms.uBrightness = currentBrightness;
    uniforms.uBloomThreshold = params.bloomThreshold;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
