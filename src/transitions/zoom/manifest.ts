import { Filter, GlProgram, Texture } from 'pixi.js';
import { clampNumber, easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface ZoomParams {
  scale: number;
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

void main(void) {
  float progress = clamp(uProgress, 0.0, 1.0);
  
  // From clip: scales up from 1.0 to uScale, fades out
  float fromScale = mix(1.0, uScale, progress);
  float fromAlpha = mix(1.0, 0.0, progress);
  
  vec2 fromUv = (vNormalizedCoord - 0.5) / fromScale + 0.5;
  vec4 fromColor = texture(uFromTexture, fromUv);
  
  // Mask out bounds just in case (though for uScale > 1 it stays inside)
  float fromInside = step(0.0, fromUv.x) * step(fromUv.x, 1.0) * step(0.0, fromUv.y) * step(fromUv.y, 1.0);
  fromColor *= fromAlpha * fromInside;

  // To clip: scales down from uScale to 1.0, fades in
  float toScale = mix(uScale, 1.0, progress);
  float toAlpha = mix(0.0, 1.0, progress);
  
  vec2 toUv = (vNormalizedCoord - 0.5) / toScale + 0.5;
  vec4 toColor = texture(uTexture, vTextureCoord + (toUv - vNormalizedCoord) * vTexScale);
  
  float toInside = step(0.0, toUv.x) * step(toUv.x, 1.0) * step(0.0, toUv.y) * step(toUv.y, 1.0);
  toColor *= toAlpha * toInside;

  // Use simple additive blending since alpha is pre-multiplied
  gl_FragColor = fromColor + toColor;
}
`;

function normalizeZoomParams(params?: Record<string, unknown>): ZoomParams {
  return {
    scale: clampNumber(params?.scale, 1.1, 10.0, 3.0),
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
      labelKey: 'granVideoEditor.timeline.transition.paramScale', // You might need to add this to i18n
      min: 1.1,
      max: 10.0,
      step: 0.1,
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
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.zoomUniforms?.uniforms;
    if (!uniforms) return;
    
    const progress = context.curve === 'bezier' 
      ? easeInOutCubic(context.progress) 
      : context.progress;
      
    const params = normalizeZoomParams(context.params);
    
    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uScale = params.scale;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
