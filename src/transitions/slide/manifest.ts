import { Filter, GlProgram, Texture } from 'pixi.js';
import {
  applyTransitionCurve,
  clampNumber,
  hexColorToRgb01,
  sanitizeTransitionColor,
} from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface SlideParams {
  direction: 'left' | 'right' | 'up' | 'down';
  gap: number;
  gapColor: string;
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
uniform float uGap;
uniform vec2 uAxis;
uniform vec3 uGapColor;
uniform float uMotionBlur;
uniform float uMotionBlurMode;
uniform float uBrightnessMode;
uniform float uBrightness;
uniform float uBloomThreshold;

vec4 getColor(vec2 uv) {
  vec2 gapVector = uAxis * uGap;
  vec2 fromOffset = uAxis * uProgress + gapVector * 0.5;
  vec2 toOffset = uAxis * (uProgress - 1.0) - gapVector * 0.5;

  vec2 fromUv = uv - fromOffset;
  vec2 toUv = uv - toOffset;

  float fromInside = step(0.0, fromUv.x) * step(fromUv.x, 1.0) * step(0.0, fromUv.y) * step(fromUv.y, 1.0);
  float toInside = step(0.0, toUv.x) * step(toUv.x, 1.0) * step(0.0, toUv.y) * step(toUv.y, 1.0);

  if (fromInside > 0.5) {
    return texture(uFromTexture, fromUv);
  } else if (toInside > 0.5) {
    // We need to map toUv back to texture coordinates.
    // toUv is in [0, 1] normalized space. 
    // vTextureCoord is vNormalizedCoord * vTexScale.
    // So toUv's texture coordinate is toUv * vTexScale.
    return texture(uTexture, toUv * vTexScale);
  } else {
    return vec4(uGapColor, 1.0);
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

  // Number of samples for motion blur
  const int SAMPLES = 16;
  vec4 accumColor = vec4(0.0);
  
  // uMotionBlur represents the amount of offset in normalized coordinates
  // We sample along the axis of movement
  float stepSize = uMotionBlur / float(SAMPLES - 1);
  float startOffset = -uMotionBlur * 0.5;

  float totalWeight = 0.0;

  for (int i = 0; i < SAMPLES; i++) {
    float offset = startOffset + float(i) * stepSize;
    vec2 sampleUv = vNormalizedCoord + uAxis * offset;
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

function normalizeSlideParams(params?: Record<string, unknown>): SlideParams {
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
    motionBlur: clampNumber(params?.motionBlur, 0, 10, 0),
    motionBlurMode: params?.motionBlurMode === 'bloom' ? 'bloom' : 'normal',
    brightnessMode: params?.brightnessMode === 'bloom' ? 'bloom' : 'normal',
    brightness: clampNumber(params?.brightness, -10, 10, 0),
    bloomThreshold: clampNumber(params?.bloomThreshold, 0, 1, 0.7),
  };
}

function getDirectionVector(direction: SlideParams['direction']): { x: number; y: number } {
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

export const slideManifest: TransitionManifest<SlideParams> = {
  type: 'slide',
  name: 'Slide',
  icon: 'i-heroicons-arrows-right-left',
  defaultDurationUs: 500_000,
  defaultParams: normalizeSlideParams(),
  normalizeParams: normalizeSlideParams,
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
    {
      key: 'motionBlur',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramMotionBlur',
      min: 0,
      max: 10,
      step: 0.01,
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
        slideUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uGap: { value: 0.02, type: 'f32' },
          uAxis: { value: [1, 0], type: 'vec2<f32>' },
          uGapColor: { value: [0, 0, 0], type: 'vec3<f32>' },
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
    const uniforms = resources?.slideUniforms?.uniforms;
    if (!uniforms) return;
    const progress = applyTransitionCurve(context.progress, context.curve);
    const params = normalizeSlideParams(context.params);
    const axis = getDirectionVector(params.direction);
    const rgb = hexColorToRgb01(params.gapColor);

    // Motion blur relies on transition speed (derivative of progress).
    // We approximate the derivative by taking a small step.
    const deltaProgress = 0.01;
    const p1 = applyTransitionCurve(Math.max(0, context.progress - deltaProgress), context.curve);
    const p2 = applyTransitionCurve(Math.min(1, context.progress + deltaProgress), context.curve);

    // The "speed" is the change in progress over the small step.
    // If curve is linear, p2 - p1 = 2 * deltaProgress.
    // So we normalize by dividing by (2 * deltaProgress).
    const speedMultiplier = (p2 - p1) / (2 * deltaProgress);

    // Calculate motion blur
    let blurAmount = 0;
    if (params.motionBlur > 0 && context.durationUs && context.durationUs > 0) {
      const durationSeconds = context.durationUs / 1_000_000;
      const baseSpeed = 1.0 / durationSeconds;

      // Blur scales with base speed and the curve's instantaneous speed multiplier
      const targetBlur = baseSpeed * params.motionBlur * 0.05 * speedMultiplier;
      blurAmount = Math.max(0, targetBlur);
    }

    // Brightness envelope (parabola peaking at middle of transition)
    // progress goes from 0 to 1. 1.0 - 2.0*abs(progress - 0.5) gives a triangle peak
    // We can use a smoother curve like sin(progress * PI)
    const envelope = Math.sin(progress * Math.PI);
    const currentBrightness = params.brightness * envelope;

    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uGap = params.gap;
    uniforms.uAxis = [axis.x, axis.y];
    uniforms.uGapColor = [rgb.r, rgb.g, rgb.b];
    uniforms.uMotionBlur = blurAmount;
    uniforms.uMotionBlurMode = params.motionBlurMode === 'bloom' ? 1.0 : 0.0;
    uniforms.uBrightnessMode = params.brightnessMode === 'bloom' ? 1.0 : 0.0;
    uniforms.uBrightness = currentBrightness;
    uniforms.uBloomThreshold = params.bloomThreshold;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
