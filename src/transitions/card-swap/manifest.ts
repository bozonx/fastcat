import { Filter, GlProgram, Texture } from 'pixi.js';
import { easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface CardSwapParams {
  direction: 'horizontal' | 'vertical';
  mode: 'zoom' | 'slide';
  slideOrder: 'normal' | 'reverse';
  maxDarkness: number;
  shadowSize: number;
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
uniform float uShadowSize;

const float depth = 3.0;
const float perspective = 0.2;

bool inBounds(vec2 p) {
  return all(lessThan(vec2(0.0), p)) && all(lessThan(p, vec2(1.0)));
}

void main(void) {
  float progress = clamp(uProgress, 0.0, 1.0);
  vec2 p = vNormalizedCoord;
  
  // Mirror logic for Slide Order (Reverse)
  float sign_order = uSlideOrder > 0.5 ? -1.0 : 1.0;
  if (sign_order < 0.0) {
    if (uDirection > 0.5) p.x = 1.0 - p.x;
    else p.y = 1.0 - p.y;
  }
  
  vec2 pfr = vec2(-1.0);
  vec2 pto = vec2(-1.0);
  float sizeFr = 1.0;
  float sizeTo = 1.0;
  float darkFr = 0.0;
  float darkTo = 0.0;

  if (uMode > 0.5) {
    // Slide mode
    vec2 dir = uDirection > 0.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    float mag = progress < 0.5 ? progress : (1.0 - progress);
    
    pfr = p + dir * mag;
    pto = p - dir * mag;
    
    darkFr = progress < 0.5 ? 0.0 : uMaxDarkness * (2.0 * progress - 1.0);
    darkTo = progress < 0.5 ? uMaxDarkness * (1.0 - 2.0 * progress) : 0.0;
  } else {
    // Zoom mode
    sizeFr = mix(1.0, depth, progress);
    float perspFr = perspective * progress;
    
    sizeTo = mix(1.0, depth, 1.0 - progress);
    float perspTo = perspective * (1.0 - progress);
    
    darkFr = uMaxDarkness * progress;
    darkTo = uMaxDarkness * (1.0 - progress);
    
    if (uDirection > 0.5) {
      // Horizontal
      pfr = (p + vec2(0.0, -0.5)) * vec2(sizeFr / (1.0 - perspective * progress), sizeFr / (1.0 - sizeFr * perspFr * p.x)) + vec2(0.0, 0.5);
      pto = (p + vec2(-1.0, -0.5)) * vec2(sizeTo / (1.0 - perspective * (1.0 - progress)), sizeTo / (1.0 - sizeTo * perspTo * (1.0 - p.x))) + vec2(1.0, 0.5);
    } else {
      // Vertical
      pfr = (p + vec2(-0.5, 0.0)) * vec2(sizeFr / (1.0 - sizeFr * perspFr * p.y), sizeFr / (1.0 - perspective * progress)) + vec2(0.5, 0.0);
      pto = (p + vec2(-0.5, -1.0)) * vec2(sizeTo / (1.0 - sizeTo * perspTo * (1.0 - p.y)), sizeTo / (1.0 - perspective * (1.0 - progress))) + vec2(0.5, 1.0);
    }
  }
  
  // Un-mirror UVs
  if (sign_order < 0.0) {
    if (uDirection > 0.5) {
      pfr.x = 1.0 - pfr.x;
      pto.x = 1.0 - pto.x;
    } else {
      pfr.y = 1.0 - pfr.y;
      pto.y = 1.0 - pto.y;
    }
  }
  
  bool pfrIn = inBounds(pfr);
  bool ptoIn = inBounds(pto);
  
  // Compute shadows
  float shadowFr = 0.0;
  if (!pfrIn && uShadowSize > 0.0) {
    vec2 d2 = max(vec2(0.0) - pfr, pfr - vec2(1.0));
    float dist = length(max(d2, 0.0)) / sizeFr;
    float maxDist = uShadowSize * 0.2;
    if (dist < maxDist && maxDist > 0.0) {
      shadowFr = (1.0 - dist / maxDist) * 0.6; // Max 60% opacity shadow
    }
  }
  
  float shadowTo = 0.0;
  if (!ptoIn && uShadowSize > 0.0) {
    vec2 d2 = max(vec2(0.0) - pto, pto - vec2(1.0));
    float dist = length(max(d2, 0.0)) / sizeTo;
    float maxDist = uShadowSize * 0.2;
    if (dist < maxDist && maxDist > 0.0) {
      shadowTo = (1.0 - dist / maxDist) * 0.6;
    }
  }

  // Draw front-to-back
  if (progress < 0.5) {
    // From is on top
    if (pfrIn) {
      vec4 c = texture(uFromTexture, pfr);
      gl_FragColor = vec4(c.rgb * (1.0 - darkFr), c.a);
    } else if (ptoIn) {
      vec4 c = texture(uTexture, vTextureCoord + (pto - vNormalizedCoord) * vTexScale);
      float totalDark = min(1.0, darkTo + shadowFr);
      gl_FragColor = vec4(c.rgb * (1.0 - totalDark), c.a);
    } else {
      gl_FragColor = vec4(0.0);
    }
  } else {
    // To is on top
    if (ptoIn) {
      vec4 c = texture(uTexture, vTextureCoord + (pto - vNormalizedCoord) * vTexScale);
      gl_FragColor = vec4(c.rgb * (1.0 - darkTo), c.a);
    } else if (pfrIn) {
      vec4 c = texture(uFromTexture, pfr);
      float totalDark = min(1.0, darkFr + shadowTo);
      gl_FragColor = vec4(c.rgb * (1.0 - totalDark), c.a);
    } else {
      gl_FragColor = vec4(0.0);
    }
  }
}
`;

function normalizeCardSwapParams(params?: Record<string, unknown>): CardSwapParams {
  return {
    direction: params?.direction === 'vertical' ? 'vertical' : 'horizontal',
    mode: params?.mode === 'slide' ? 'slide' : 'zoom',
    slideOrder: params?.slideOrder === 'reverse' ? 'reverse' : 'normal',
    maxDarkness:
      typeof params?.maxDarkness === 'number' ? Math.max(0, Math.min(1, params.maxDarkness)) : 0.5,
    shadowSize:
      typeof params?.shadowSize === 'number' ? Math.max(0, Math.min(1, params.shadowSize)) : 0.2,
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
    },
    {
      key: 'maxDarkness',
      kind: 'slider',
      labelKey: 'granVideoEditor.timeline.transition.paramMaxDarkness',
      min: 0,
      max: 1,
      step: 0.05,
    },
    {
      key: 'shadowSize',
      kind: 'slider',
      labelKey: 'granVideoEditor.timeline.transition.paramShadowSize',
      min: 0,
      max: 1,
      step: 0.05,
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
          uShadowSize: { value: 0.2, type: 'f32' },
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
    uniforms.uShadowSize = params.shadowSize;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
