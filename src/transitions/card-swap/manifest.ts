import { Filter, GlProgram, Texture } from 'pixi.js';
import { easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface CardSwapParams {
  direction: 'horizontal' | 'vertical';
  mode: 'zoom' | 'slide';
  slideOrder: 'normal' | 'reverse';
  maxDarkness: number;
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
uniform float uDirection;
uniform float uMode;
uniform float uSlideOrder;
uniform float uMaxDarkness;

const float depth = 3.0;
const float perspective = 0.2;

bool inBounds(vec2 p) {
  return all(lessThan(vec2(0.0), p)) && all(lessThan(p, vec2(1.0)));
}

void main(void) {
  float progress = clamp(uProgress, 0.0, 1.0);
  vec2 p = vNormalizedCoord;
  
  if (uMode > 0.5) {
    // Slide mode
    vec2 dir = uDirection > 0.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    float sign = uSlideOrder > 0.5 ? -1.0 : 1.0;
    
    float mag = progress < 0.5 ? progress : (1.0 - progress);
    
    // If sign=1.0, from moves left (-dir), so to sample it we add dir*mag
    vec2 pfr = p + sign * dir * mag;
    vec2 pto = p - sign * dir * mag;
    
    if (progress < 0.5) {
      if (inBounds(pfr)) {
        gl_FragColor = texture(uFromTexture, pfr);
        return;
      }
      if (inBounds(pto)) {
        vec4 c = texture(uTexture, vTextureCoord + (pto - p) * vTexScale);
        float dark = uMaxDarkness * (1.0 - 2.0 * progress);
        gl_FragColor = vec4(c.rgb * (1.0 - dark), c.a);
        return;
      }
    } else {
      if (inBounds(pto)) {
        gl_FragColor = texture(uTexture, vTextureCoord + (pto - p) * vTexScale);
        return;
      }
      if (inBounds(pfr)) {
        vec4 c = texture(uFromTexture, pfr);
        float dark = uMaxDarkness * (2.0 * progress - 1.0);
        gl_FragColor = vec4(c.rgb * (1.0 - dark), c.a);
        return;
      }
    }
    
    gl_FragColor = vec4(0.0);
    return;
  }
  
  vec2 pfr = vec2(-1.0);
  vec2 pto = vec2(-1.0);
  
  float sizeFr = mix(1.0, depth, progress);
  float perspFr = perspective * progress;
  
  float sizeTo = mix(1.0, depth, 1.0 - progress);
  float perspTo = perspective * (1.0 - progress);
  
  if (uDirection > 0.5) {
    // Horizontal
    pfr = (p + vec2(-0.0, -0.5)) * vec2(sizeFr / (1.0 - perspective * progress), sizeFr / (1.0 - sizeFr * perspFr * p.x)) + vec2(0.0, 0.5);
    pto = (p + vec2(-1.0, -0.5)) * vec2(sizeTo / (1.0 - perspective * (1.0 - progress)), sizeTo / (1.0 - sizeTo * perspTo * (0.5 - p.x))) + vec2(1.0, 0.5);
  } else {
    // Vertical
    pfr = (p + vec2(-0.5, -0.0)) * vec2(sizeFr / (1.0 - sizeFr * perspFr * p.y), sizeFr / (1.0 - perspective * progress)) + vec2(0.5, 0.0);
    pto = (p + vec2(-0.5, -1.0)) * vec2(sizeTo / (1.0 - sizeTo * perspTo * (0.5 - p.y)), sizeTo / (1.0 - perspective * (1.0 - progress))) + vec2(0.5, 1.0);
  }
  
  if (progress < 0.5) {
    if (inBounds(pfr)) {
      gl_FragColor = texture(uFromTexture, pfr);
      return;
    }
    if (inBounds(pto)) {
      gl_FragColor = texture(uTexture, vTextureCoord + (pto - p) * vTexScale);
      return;
    }
  } else {
    if (inBounds(pto)) {
      gl_FragColor = texture(uTexture, vTextureCoord + (pto - p) * vTexScale);
      return;
    }
    if (inBounds(pfr)) {
      gl_FragColor = texture(uFromTexture, pfr);
      return;
    }
  }
  
  gl_FragColor = vec4(0.0);
}
`;

function normalizeCardSwapParams(params?: Record<string, unknown>): CardSwapParams {
  return {
    direction: params?.direction === 'vertical' ? 'vertical' : 'horizontal',
    mode: params?.mode === 'slide' ? 'slide' : 'zoom',
    slideOrder: params?.slideOrder === 'reverse' ? 'reverse' : 'normal',
    maxDarkness:
      typeof params?.maxDarkness === 'number' ? Math.max(0, Math.min(1, params.maxDarkness)) : 0.5,
  };
}

export const cardSwapTransitionManifest: TransitionManifest<CardSwapParams> = {
  type: 'card-swap' as any,
  name: 'Card Swap',
  icon: 'i-heroicons-arrow-path-rounded-square',
  defaultDurationUs: 500_000,
  defaultParams: normalizeCardSwapParams(),
  normalizeParams: normalizeCardSwapParams,
  paramFields: [
    {
      key: 'mode',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramCardSwapMode',
      options: [
        { value: 'zoom', labelKey: 'granVideoEditor.timeline.transition.modeZoom' },
        { value: 'slide', labelKey: 'granVideoEditor.timeline.transition.modeSlide' },
      ],
    },
    {
      key: 'direction',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramDirection',
      options: [
        {
          value: 'horizontal',
          labelKey: 'granVideoEditor.timeline.transition.directionHorizontal',
        },
        { value: 'vertical', labelKey: 'granVideoEditor.timeline.transition.directionVertical' },
      ],
    },
    {
      key: 'slideOrder',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramSlideOrder',
      options: [
        { value: 'normal', labelKey: 'granVideoEditor.timeline.transition.slideOrderNormal' },
        { value: 'reverse', labelKey: 'granVideoEditor.timeline.transition.slideOrderReverse' },
      ],
      showIf: (params: any) => params.mode === 'slide',
    },
    {
      key: 'maxDarkness',
      kind: 'slider',
      labelKey: 'granVideoEditor.timeline.transition.paramMaxDarkness',
      min: 0,
      max: 1,
      step: 0.05,
      showIf: (params: any) => params.mode === 'slide',
    },
  ],
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        cardSwapUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uDirection: { value: 1, type: 'f32' },
          uMode: { value: 0, type: 'f32' },
          uSlideOrder: { value: 0, type: 'f32' },
          uMaxDarkness: { value: 0.5, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.cardSwapUniforms?.uniforms;
    if (!uniforms) return;
    const progress =
      context.curve === 'bezier' ? easeInOutCubic(context.progress) : context.progress;
    const params = normalizeCardSwapParams(context.params);
    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uDirection = params.direction === 'vertical' ? 0 : 1;
    uniforms.uMode = params.mode === 'slide' ? 1 : 0;
    uniforms.uSlideOrder = params.slideOrder === 'reverse' ? 1 : 0;
    uniforms.uMaxDarkness = params.maxDarkness;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
