import { Filter, GlProgram, Texture } from 'pixi.js';
import type { TransitionManifest } from '../core/registry';
import { easeInOutCubic } from '../core/registry';

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

void main(void) {
  float progress = clamp(uProgress, 0.0, 1.0);
  
  vec4 fromColor = texture(uFromTexture, vNormalizedCoord);
  vec4 toColor = texture(uTexture, vTextureCoord);
  
  vec4 baseColor = mix(fromColor, toColor, progress);
  
  if (uIsBloom < 0.5) {
    gl_FragColor = baseColor;
    return;
  }
  
  // Simple blur for bloom
  // We apply more bloom at the peak of the transition (progress = 0.5)
  float peak = 1.0 - abs(progress - 0.5) * 2.0; // 0 at edges, 1 at middle
  
  float blurAmount = uBlurLevel * peak * 0.05;
  vec4 bloomColor = vec4(0.0);
  
  // 9-tap blur
  vec2 texelSize = vTexScale;
  
  bloomColor += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(-1.0, -1.0) * blurAmount)) * 0.0625;
  bloomColor += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(0.0, -1.0) * blurAmount)) * 0.125;
  bloomColor += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(1.0, -1.0) * blurAmount)) * 0.0625;
  bloomColor += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(-1.0, 0.0) * blurAmount)) * 0.125;
  bloomColor += extractBright(fromColor) * 0.25;
  bloomColor += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(1.0, 0.0) * blurAmount)) * 0.125;
  bloomColor += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(-1.0, 1.0) * blurAmount)) * 0.0625;
  bloomColor += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(0.0, 1.0) * blurAmount)) * 0.125;
  bloomColor += extractBright(texture(uFromTexture, vNormalizedCoord + vec2(1.0, 1.0) * blurAmount)) * 0.0625;
  
  vec4 bloomColorTo = vec4(0.0);
  bloomColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(-1.0, -1.0) * blurAmount)) * 0.0625;
  bloomColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(0.0, -1.0) * blurAmount)) * 0.125;
  bloomColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(1.0, -1.0) * blurAmount)) * 0.0625;
  bloomColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(-1.0, 0.0) * blurAmount)) * 0.125;
  bloomColorTo += extractBright(toColor) * 0.25;
  bloomColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(1.0, 0.0) * blurAmount)) * 0.125;
  bloomColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(-1.0, 1.0) * blurAmount)) * 0.0625;
  bloomColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(0.0, 1.0) * blurAmount)) * 0.125;
  bloomColorTo += extractBright(texture(uTexture, vTextureCoord + vec2(1.0, 1.0) * blurAmount)) * 0.0625;
  
  vec4 mixedBloom = mix(bloomColor, bloomColorTo, progress);
  
  vec4 outColor = baseColor + mixedBloom * uBrightness * peak;
  // Ensure we don't exceed 1.0 and keep alpha correct
  outColor.rgb = min(outColor.rgb, vec3(1.0));
  outColor.a = baseColor.a;
  
  gl_FragColor = outColor;
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
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramMode',
      options: [
        { value: 'bloom', labelKey: 'granVideoEditor.timeline.transition.modeBloom' },
        { value: 'normal', labelKey: 'granVideoEditor.timeline.transition.modeNormal' },
      ],
    },
    {
      key: 'brightness',
      kind: 'slider',
      labelKey: 'granVideoEditor.timeline.transition.paramBrightness',
      min: 0.1,
      max: 5.0,
      step: 0.1,
      showIf: (params) => params.mode !== 'normal',
    },
    {
      key: 'blurLevel',
      kind: 'slider',
      labelKey: 'granVideoEditor.timeline.transition.paramBlur',
      min: 0.0,
      max: 3.0,
      step: 0.1,
      showIf: (params) => params.mode !== 'normal',
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

    const progress =
      context.curve === 'bezier' ? easeInOutCubic(context.progress) : context.progress;
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
