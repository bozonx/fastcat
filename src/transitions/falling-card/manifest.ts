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
in vec2 vTextureCoord;
in vec2 vNormalizedCoord;
in vec2 vTexScale;

uniform sampler2D uTexture;
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
  
  // В PixiJS Custom Filters для переходов (например, cube или slide):
  // uFromTexture: Целевая текстура, куда мы переходим (TO)
  // uTexture: Исходная текстура, на которую наложен фильтр (FROM)
  
  vec4 toColor = texture(uFromTexture, p);
  
  if (progress >= 1.0) {
      gl_FragColor = toColor;
      return;
  }
  
  if (progress <= 0.0) {
      gl_FragColor = texture(uTexture, vTextureCoord);
      return;
  }
  
  vec2 pfr = vec2(-1.0);
  float sizeFr = mix(1.0, depth, progress);
  float perspFr = perspective * progress;
  
  if (uDirection < 0.5) { // down
    pfr = (p + vec2(-0.5, -1.0)) * vec2(sizeFr / (1.0 - sizeFr * perspFr * (1.0 - p.y)), sizeFr / (1.0 - perspective * progress)) + vec2(0.5, 1.0);
  } else if (uDirection < 1.5) { // up
    pfr = (p + vec2(-0.5, 0.0)) * vec2(sizeFr / (1.0 - sizeFr * perspFr * p.y), sizeFr / (1.0 - perspective * progress)) + vec2(0.5, 0.0);
  } else if (uDirection < 2.5) { // right
    pfr = (p + vec2(-1.0, -0.5)) * vec2(sizeFr / (1.0 - perspective * progress), sizeFr / (1.0 - sizeFr * perspFr * (1.0 - p.x))) + vec2(1.0, 0.5);
  } else { // left
    pfr = (p + vec2(0.0, -0.5)) * vec2(sizeFr / (1.0 - perspective * progress), sizeFr / (1.0 - sizeFr * perspFr * p.x)) + vec2(0.0, 0.5);
  }
  
  if (inBounds(pfr)) {
      float shadow = mix(1.0, 0.3, progress);
      // Берём текстуру из уходящего клипа (uTexture) с правильным смещением координат!
      // pfr - это нормализованная координата (0..1), а uTexture требует vTextureCoord
      vec2 offset = pfr - p;
      vec4 cardColor = texture(uTexture, vTextureCoord + offset * vTexScale);
      
      // Поскольку PixiJS работает с Premultiplied Alpha
      cardColor.rgb *= shadow;
      
      gl_FragColor = cardColor + toColor * (1.0 - cardColor.a);
  } else {
      gl_FragColor = toColor;
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
