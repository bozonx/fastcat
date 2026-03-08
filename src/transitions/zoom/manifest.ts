import { Filter, GlProgram, Texture } from 'pixi.js';
import { applyTransitionCurve, clampNumber } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface ZoomParams {
  scale: number;
  fromRotation: number;
  toRotation: number;
  blur: number;
  blurQuality: 'low' | 'medium' | 'high' | 'ultra';
  brightnessMode: 'normal' | 'bloom';
  brightness: number;
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
uniform float uScale;
uniform float uFromRotation;
uniform float uToRotation;
uniform float uAspect;
uniform float uBlur;
uniform float uBlurSamples;
uniform float uBrightnessMode;
uniform float uBrightness;

vec2 rotate(vec2 pt, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  pt.x *= uAspect;
  vec2 rotated = vec2(pt.x * c - pt.y * s, pt.x * s + pt.y * c);
  rotated.x /= uAspect;
  return rotated;
}

float getLuminance(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

vec4 sampleFrom(vec2 uv, float blurAmount, float brightFactor, float blurFade) {
  vec4 origColor = texture(uFromTexture, uv);
  if (uBrightnessMode < 0.5) {
      if (blurAmount < 0.001) return vec4(origColor.rgb * brightFactor, origColor.a);
      vec2 center = vec2(0.5, 0.5);
      vec2 dir = center - uv;
      vec4 colorSum = vec4(0.0);
      float samples = uBlurSamples;
      for (float i = 0.0; i < 64.0; i += 1.0) {
         if (i >= samples) break;
         float t = i / samples;
         colorSum += texture(uFromTexture, uv + dir * (t * blurAmount));
      }
      vec4 blurred = colorSum / samples;
      return vec4(blurred.rgb * brightFactor, blurred.a);
  } else {
      if (blurAmount < 0.001) {
          float origLum = getLuminance(origColor.rgb);
          float origBoost = smoothstep(0.4, 1.0, origLum) * (brightFactor - 1.0);
          return vec4(origColor.rgb + origColor.rgb * origBoost, origColor.a);
      }
      vec2 center = vec2(0.5, 0.5);
      vec2 dir = center - uv;
      vec4 bloomSum = vec4(0.0);
      float samples = uBlurSamples;
      for (float i = 0.0; i < 64.0; i += 1.0) {
         if (i >= samples) break;
         float t = i / samples;
         vec4 sColor = texture(uFromTexture, uv + dir * (t * blurAmount));
         float lum = getLuminance(sColor.rgb);
         float w = smoothstep(0.4, 1.0, lum);
         bloomSum += sColor * w;
      }
      vec4 bloomColor = bloomSum / samples;
      
      float origLum = getLuminance(origColor.rgb);
      float origBoost = smoothstep(0.4, 1.0, origLum) * (brightFactor - 1.0);
      float extraBloom = (brightFactor - 1.0) * 2.0;
      vec3 finalRgb = origColor.rgb + origColor.rgb * origBoost + bloomColor.rgb * blurFade * (1.0 + extraBloom);
      return vec4(finalRgb, origColor.a);
  }
}

vec4 sampleTo(vec2 uv, float blurAmount, float brightFactor, float blurFade) {
  vec2 baseTexCoord = vTextureCoord + (uv - vNormalizedCoord) * vTexScale;
  vec4 origColor = texture(uTexture, baseTexCoord);
  if (uBrightnessMode < 0.5) {
      if (blurAmount < 0.001) return vec4(origColor.rgb * brightFactor, origColor.a);
      vec2 center = vec2(0.5, 0.5);
      vec2 dir = center - uv;
      vec4 colorSum = vec4(0.0);
      float samples = uBlurSamples;
      for (float i = 0.0; i < 64.0; i += 1.0) {
         if (i >= samples) break;
         float t = i / samples;
         vec2 offsetNorm = dir * (t * blurAmount);
         colorSum += texture(uTexture, baseTexCoord + offsetNorm * vTexScale);
      }
      vec4 blurred = colorSum / samples;
      return vec4(blurred.rgb * brightFactor, blurred.a);
  } else {
      if (blurAmount < 0.001) {
          float origLum = getLuminance(origColor.rgb);
          float origBoost = smoothstep(0.4, 1.0, origLum) * (brightFactor - 1.0);
          return vec4(origColor.rgb + origColor.rgb * origBoost, origColor.a);
      }
      vec2 center = vec2(0.5, 0.5);
      vec2 dir = center - uv;
      vec4 bloomSum = vec4(0.0);
      float samples = uBlurSamples;
      for (float i = 0.0; i < 64.0; i += 1.0) {
         if (i >= samples) break;
         float t = i / samples;
         vec2 offsetNorm = dir * (t * blurAmount);
         vec4 sColor = texture(uTexture, baseTexCoord + offsetNorm * vTexScale);
         float lum = getLuminance(sColor.rgb);
         float w = smoothstep(0.4, 1.0, lum);
         bloomSum += sColor * w;
      }
      vec4 bloomColor = bloomSum / samples;
      
      float origLum = getLuminance(origColor.rgb);
      float origBoost = smoothstep(0.4, 1.0, origLum) * (brightFactor - 1.0);
      float extraBloom = (brightFactor - 1.0) * 2.0;
      vec3 finalRgb = origColor.rgb + origColor.rgb * origBoost + bloomColor.rgb * blurFade * (1.0 + extraBloom);
      return vec4(finalRgb, origColor.a);
  }
}

out vec4 finalColor;
void main(void) {
  float progress = clamp(uProgress, 0.0, 1.0);
  
  // From clip: scales up from 1.0 to uScale, rotates from 0 to uFromRotation, fades out
  float fromScale = mix(1.0, uScale, progress);
  float fromAlpha = mix(1.0, 0.0, progress);
  float fromAngle = mix(0.0, uFromRotation, progress);
  float fromBlur = mix(0.0, uBlur * 0.005, progress);
  float fromBrightFactor = mix(1.0, 1.0 + uBrightness, progress);
  
  vec2 fromCentered = vNormalizedCoord - 0.5;
  fromCentered = rotate(fromCentered, fromAngle);
  vec2 fromUv = fromCentered / fromScale + 0.5;
  
  vec4 fromColor = sampleFrom(fromUv, fromBlur, fromBrightFactor, progress);
  
  // Mask out bounds
  float fromInside = step(0.0, fromUv.x) * step(fromUv.x, 1.0) * step(0.0, fromUv.y) * step(fromUv.y, 1.0);
  fromColor *= fromAlpha * fromInside;

  // To clip: scales down from uScale to 1.0, rotates from uToRotation to 0, fades in
  float toScale = mix(uScale, 1.0, progress);
  float toAlpha = mix(0.0, 1.0, progress);
  float toAngle = mix(uToRotation, 0.0, progress);
  float toBlur = mix(uBlur * 0.005, 0.0, progress);
  float toBrightFactor = mix(1.0 + uBrightness, 1.0, progress);
  
  vec2 toCentered = vNormalizedCoord - 0.5;
  toCentered = rotate(toCentered, toAngle);
  vec2 toUv = toCentered / toScale + 0.5;
  
  vec4 toColor = sampleTo(toUv, toBlur, toBrightFactor, 1.0 - progress);
  
  float toInside = step(0.0, toUv.x) * step(toUv.x, 1.0) * step(0.0, toUv.y) * step(toUv.y, 1.0);
  toColor *= toAlpha * toInside;

  finalColor = fromColor + toColor;
}
`;

function normalizeZoomParams(params?: Record<string, unknown>): ZoomParams {
  return {
    scale: clampNumber(params?.scale, 1.1, 10.0, 3.0),
    fromRotation: clampNumber(params?.fromRotation, -360, 360, 0),
    toRotation: clampNumber(params?.toRotation, -360, 360, 0),
    blur: clampNumber(params?.blur, 0, 100, 20),
    blurQuality:
      params?.blurQuality === 'low' ||
      params?.blurQuality === 'medium' ||
      params?.blurQuality === 'high' ||
      params?.blurQuality === 'ultra'
        ? params.blurQuality
        : 'medium',
    brightnessMode: params?.brightnessMode === 'bloom' ? 'bloom' : 'normal',
    brightness: clampNumber(params?.brightness, 0, 5, 0),
  };
}

export const zoomManifest: TransitionManifest<ZoomParams> = {
  type: 'zoom',
  name: 'Zoom',
  icon: 'i-heroicons-magnifying-glass',
  defaultDurationUs: 500_000,
  defaultParams: normalizeZoomParams(),
  normalizeParams: normalizeZoomParams,
  paramFields: [
    {
      key: 'scale',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramScale',
      min: 1.1,
      max: 10.0,
      step: 0.1,
    },
    {
      key: 'blur',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramBlur',
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: 'blurQuality',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramBlurQuality',
      options: [
        { value: 'low', labelKey: 'granVideoEditor.timeline.transition.blurQualityLow' },
        { value: 'medium', labelKey: 'granVideoEditor.timeline.transition.blurQualityMedium' },
        { value: 'high', labelKey: 'granVideoEditor.timeline.transition.blurQualityHigh' },
        { value: 'ultra', labelKey: 'granVideoEditor.timeline.transition.blurQualityUltra' },
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
      kind: 'slider',
      labelKey: 'granVideoEditor.timeline.transition.paramBrightness',
      min: 0,
      max: 5,
      step: 0.1,
    },
    {
      key: 'fromRotation',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramFromRotation',
      min: -360,
      max: 360,
      step: 1,
    },
    {
      key: 'toRotation',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramToRotation',
      min: -360,
      max: 360,
      step: 1,
    },
  ],
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        zoomUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uScale: { value: 3.0, type: 'f32' },
          uFromRotation: { value: 0, type: 'f32' },
          uToRotation: { value: 0, type: 'f32' },
          uAspect: { value: 16.0 / 9.0, type: 'f32' },
          uBlur: { value: 20.0, type: 'f32' },
          uBlurSamples: { value: 16.0, type: 'f32' },
          uBrightnessMode: { value: 0, type: 'f32' },
          uBrightness: { value: 0, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.zoomUniforms?.uniforms;
    if (!uniforms) return;

    const progress = applyTransitionCurve(context.progress, context.curve);

    const params = normalizeZoomParams(context.params);

    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uScale = params.scale;
    uniforms.uFromRotation = (params.fromRotation * Math.PI) / 180;
    uniforms.uToRotation = (params.toRotation * Math.PI) / 180;
    uniforms.uBlur = params.blur;

    let samples = 16.0;
    if (params.blurQuality === 'low') samples = 8.0;
    else if (params.blurQuality === 'medium') samples = 16.0;
    else if (params.blurQuality === 'high') samples = 32.0;
    else if (params.blurQuality === 'ultra') samples = 64.0;
    uniforms.uBlurSamples = samples;

    uniforms.uBrightnessMode = params.brightnessMode === 'bloom' ? 1.0 : 0.0;
    uniforms.uBrightness = params.brightness;

    // Attempt to deduce aspect ratio from texture dimensions if available
    if (context.fromTexture) {
      uniforms.uAspect = context.fromTexture.width / context.fromTexture.height;
    } else if (context.toTexture) {
      uniforms.uAspect = context.toTexture.width / context.toTexture.height;
    }
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
