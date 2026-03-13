import { Filter, GlProgram, Texture } from 'pixi.js';
import type { TransitionManifest } from '../core/registry';
import { applyTransitionCurve } from '../core/registry';

export interface BloomParams {
  brightness: number;
  blurLevel: number;
  mode: 'bloom' | 'normal';
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
uniform float uBrightness;
uniform float uBlurLevel;
uniform float uIsBloom;

// Extract bright parts
vec4 extractBright(vec4 color) {
  float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  float threshold = 0.5;
  float intensity = smoothstep(threshold, threshold + 0.2, luminance);
  return color * intensity;
}

out vec4 finalColor;
void main(void) {
  float progress = clamp(uProgress, 0.0, 1.0);
  
  vec4 fromColor = texture(uFromTexture, vNormalizedCoord);
  vec4 toColor = texture(uTexture, vTextureCoord);
  
  vec4 baseColor = mix(fromColor, toColor, progress);
  
  float peak = 1.0 - abs(progress - 0.5) * 2.0; // 0 at edges, 1 at middle
  float blurAmount = uBlurLevel * peak * 0.05;
  
  vec4 blurColorFrom = vec4(0.0);
  vec4 blurColorTo = vec4(0.0);
  
  if (uIsBloom > 0.5) {
    // Bloom mode: blur only bright parts
    blurColorFrom += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(-1.0, -1.0) * blurAmount)) * 0.0625;
    blurColorFrom += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(0.0, -1.0) * blurAmount)) * 0.125;
    blurColorFrom += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(1.0, -1.0) * blurAmount)) * 0.0625;
    blurColorFrom += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(-1.0, 0.0) * blurAmount)) * 0.125;
    blurColorFrom += extractBright(fromColor) * 0.25;
    blurColorFrom += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(1.0, 0.0) * blurAmount)) * 0.125;
    blurColorFrom += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(-1.0, 1.0) * blurAmount)) * 0.0625;
    blurColorFrom += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(0.0, 1.0) * blurAmount)) * 0.125;
    blurColorFrom += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(1.0, 1.0) * blurAmount)) * 0.0625;
    
    blurColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(-1.0, -1.0) * blurAmount)) * 0.0625;
    blurColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(0.0, -1.0) * blurAmount)) * 0.125;
    blurColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(1.0, -1.0) * blurAmount)) * 0.0625;
    blurColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(-1.0, 0.0) * blurAmount)) * 0.125;
    blurColorTo += extractBright(toColor) * 0.25;
    blurColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(1.0, 0.0) * blurAmount)) * 0.125;
    blurColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(-1.0, 1.0) * blurAmount)) * 0.0625;
    blurColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(0.0, 1.0) * blurAmount)) * 0.125;
    blurColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(1.0, 1.0) * blurAmount)) * 0.0625;
    
    vec4 mixedBloom = mix(blurColorFrom, blurColorTo, progress);
    vec4 outColor = baseColor + mixedBloom * uBrightness * peak;
    outColor.rgb = min(outColor.rgb, vec3(1.0));
    outColor.a = baseColor.a;
    finalColor = outColor;
  } else {
    // Normal mode: blur whole image and apply brightness uniformly
    blurColorFrom += texture(uFromTexture, vNormalizedCoord + vec2(-1.0, -1.0) * blurAmount) * 0.0625;
    blurColorFrom += texture(uFromTexture, vNormalizedCoord + vec2(0.0, -1.0) * blurAmount) * 0.125;
    blurColorFrom += texture(uFromTexture, vNormalizedCoord + vec2(1.0, -1.0) * blurAmount) * 0.0625;
    blurColorFrom += texture(uFromTexture, vNormalizedCoord + vec2(-1.0, 0.0) * blurAmount) * 0.125;
    blurColorFrom += fromColor * 0.25;
    blurColorFrom += texture(uFromTexture, vNormalizedCoord + vec2(1.0, 0.0) * blurAmount) * 0.125;
    blurColorFrom += texture(uFromTexture, vNormalizedCoord + vec2(-1.0, 1.0) * blurAmount) * 0.0625;
    blurColorFrom += texture(uFromTexture, vNormalizedCoord + vec2(0.0, 1.0) * blurAmount) * 0.125;
    blurColorFrom += texture(uFromTexture, vNormalizedCoord + vec2(1.0, 1.0) * blurAmount) * 0.0625;
    
    blurColorTo += texture(uTexture, vTextureCoord + vec2(-1.0, -1.0) * blurAmount) * 0.0625;
    blurColorTo += texture(uTexture, vTextureCoord + vec2(0.0, -1.0) * blurAmount) * 0.125;
    blurColorTo += texture(uTexture, vTextureCoord + vec2(1.0, -1.0) * blurAmount) * 0.0625;
    blurColorTo += texture(uTexture, vTextureCoord + vec2(-1.0, 0.0) * blurAmount) * 0.125;
    blurColorTo += toColor * 0.25;
    blurColorTo += texture(uTexture, vTextureCoord + vec2(1.0, 0.0) * blurAmount) * 0.125;
    blurColorTo += texture(uTexture, vTextureCoord + vec2(-1.0, 1.0) * blurAmount) * 0.0625;
    blurColorTo += texture(uTexture, vTextureCoord + vec2(0.0, 1.0) * blurAmount) * 0.125;
    blurColorTo += texture(uTexture, vTextureCoord + vec2(1.0, 1.0) * blurAmount) * 0.0625;
    
    vec4 mixedBlur = mix(blurColorFrom, blurColorTo, progress);
    
    // Apply brightness multiplier smoothly towards middle
    float brightnessMult = mix(1.0, uBrightness, peak);
    vec4 outColor = mixedBlur * brightnessMult;
    outColor.rgb = min(outColor.rgb, vec3(1.0));
    outColor.a = baseColor.a;
    finalColor = outColor;
  }
}
`;

function normalizeBloomParams(params?: Record<string, unknown>): BloomParams {
  const brightness = typeof params?.brightness === 'number' ? params.brightness : 1.5;
  const blurLevel = typeof params?.blurLevel === 'number' ? params.blurLevel : 1.0;
  const mode = params?.mode === 'normal' ? 'normal' : 'bloom';

  return { brightness, blurLevel, mode };
}

export const bloomManifest: TransitionManifest<BloomParams> = {
  type: 'bloom' as any,
  name: 'Bloom',
  icon: 'i-heroicons-sparkles',
  defaultDurationUs: 500_000,
  defaultParams: normalizeBloomParams(),
  normalizeParams: normalizeBloomParams,
  paramFields: [
    {
      key: 'mode',
      kind: 'button-group',
      labelKey: 'fastcat.timeline.transition.paramMode',
      options: [
        { value: 'bloom', labelKey: 'fastcat.timeline.transition.modeBloom' },
        { value: 'normal', labelKey: 'fastcat.timeline.transition.modeNormal' },
      ],
    },
    {
      key: 'brightness',
      kind: 'slider',
      labelKey: 'fastcat.timeline.transition.paramBrightness',
      min: 0.1,
      max: 5.0,
      step: 0.1,
    },
    {
      key: 'blurLevel',
      kind: 'slider',
      labelKey: 'fastcat.timeline.transition.paramBlur',
      min: 0.0,
      max: 3.0,
      step: 0.1,
    },
  ],
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        bloomUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uBrightness: { value: 1.5, type: 'f32' },
          uBlurLevel: { value: 1.0, type: 'f32' },
          uIsBloom: { value: 1.0, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.bloomUniforms?.uniforms;
    if (!uniforms) return;

    const progress = applyTransitionCurve(context.progress, context.curve);
    const params = normalizeBloomParams(context.params);

    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;

    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uBrightness = params.brightness;
    uniforms.uBlurLevel = params.blurLevel;
    uniforms.uIsBloom = params.mode === 'normal' ? 0.0 : 1.0;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
