import { Filter, GlProgram, Texture } from 'pixi.js';
import { easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface FallingCardParams {
  direction: 'down' | 'up' | 'left' | 'right';
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
  vec2 position = aPosition * max(uOutputFrame.zw, vec2(0.)) + uOutputFrame.xy;
  return vec4((position / uOutputTexture.zw) * 2.0 - 1.0, 0.0, 1.0);
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
precision highp float;

in vec2 vTextureCoord;
in vec2 vNormalizedCoord;
in vec2 vTexScale;

uniform sampler2D uSampler; // This is the FROM texture in the new transition model
uniform sampler2D uTexture; // Custom uniform for TO texture, though typically we just use uSampler and we supply uFromTexture
uniform sampler2D uFromTexture;
uniform float uProgress;
uniform float uDirection;

const float depth = 3.0;
const float perspective = 0.2;

bool inBounds(vec2 p) {
  return all(lessThan(vec2(0.0), p)) && all(lessThan(p, vec2(1.0)));
}

void main(void) {
  float progress = clamp(uProgress, 0.0, 1.0);
  vec2 p = vNormalizedCoord;
  
  // In the current Pixi filter setup for transitions:
  // uSampler is the filter target (the FROM clip)
  // uFromTexture is the next clip (the TO clip) passed via context.fromTexture
  
  vec4 bgColor = texture(uFromTexture, p);
  
  if (progress >= 1.0) {
      gl_FragColor = bgColor;
      return;
  }
  
  vec2 pfr = vec2(-1.0);
  float sizeFr = mix(1.0, depth, progress);
  float perspFr = perspective * progress;
  
  if (uDirection < 0.5) {
    // down (pivot bottom, y=1)
    pfr = (p + vec2(-0.5, -1.0)) * vec2(sizeFr / (1.0 - sizeFr * perspFr * (1.0 - p.y)), sizeFr / (1.0 - perspective * progress)) + vec2(0.5, 1.0);
  } else if (uDirection < 1.5) {
    // up (pivot top, y=0)
    pfr = (p + vec2(-0.5, 0.0)) * vec2(sizeFr / (1.0 - sizeFr * perspFr * p.y), sizeFr / (1.0 - perspective * progress)) + vec2(0.5, 0.0);
  } else if (uDirection < 2.5) {
    // right (pivot right, x=1)
    pfr = (p + vec2(-1.0, -0.5)) * vec2(sizeFr / (1.0 - perspective * progress), sizeFr / (1.0 - sizeFr * perspFr * (1.0 - p.x))) + vec2(1.0, 0.5);
  } else {
    // left (pivot left, x=0)
    pfr = (p + vec2(0.0, -0.5)) * vec2(sizeFr / (1.0 - perspective * progress), sizeFr / (1.0 - sizeFr * perspFr * p.x)) + vec2(0.0, 0.5);
  }
  
  if (inBounds(pfr)) {
      float shadow = mix(1.0, 0.3, progress);
      vec4 cardColor = texture(uSampler, vTextureCoord + (pfr - p) * vTexScale);
      cardColor.rgb *= shadow;
      
      gl_FragColor = vec4(mix(bgColor.rgb, cardColor.rgb, cardColor.a), max(bgColor.a, cardColor.a));
  } else {
      gl_FragColor = bgColor;
  }
}
`;

function normalizeFallingCardParams(params?: Record<string, unknown>): FallingCardParams {
  const dir = params?.direction as string;
  const validDirs = ['down', 'up', 'left', 'right'];
  return {
    direction: validDirs.includes(dir) ? (dir as FallingCardParams['direction']) : 'down',
  };
}

export const fallingCardTransitionManifest: TransitionManifest<FallingCardParams> = {
  type: 'falling-card' as any,
  name: 'Falling Card',
  icon: 'i-heroicons-square-3-stack-3d',
  defaultDurationUs: 500_000,
  defaultParams: normalizeFallingCardParams(),
  normalizeParams: normalizeFallingCardParams,
  paramFields: [
    {
      key: 'direction',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramDirection',
      options: [
        {
          value: 'down',
          labelKey: 'granVideoEditor.timeline.transition.directionDown',
        },
        {
          value: 'up',
          labelKey: 'granVideoEditor.timeline.transition.directionUp',
        },
        {
          value: 'left',
          labelKey: 'granVideoEditor.timeline.transition.directionLeft',
        },
        {
          value: 'right',
          labelKey: 'granVideoEditor.timeline.transition.directionRight',
        },
      ],
    },
  ],
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        fallingCardUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uDirection: { value: 0, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.fallingCardUniforms?.uniforms;
    if (!uniforms) return;
    const progress =
      context.curve === 'bezier' ? easeInOutCubic(context.progress) : context.progress;
    const params = normalizeFallingCardParams(context.params);
    
    let dirFloat = 0;
    if (params.direction === 'up') dirFloat = 1;
    else if (params.direction === 'right') dirFloat = 2;
    else if (params.direction === 'left') dirFloat = 3;

    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uDirection = dirFloat;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
