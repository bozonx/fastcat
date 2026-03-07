import { Filter, GlProgram, Texture } from 'pixi.js';
import { easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface CardSwapParams {
  direction: 'horizontal' | 'vertical';
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

const float depth = 3.0;
const float perspective = 0.2;

bool inBounds(vec2 p) {
  return all(lessThan(vec2(0.0), p)) && all(lessThan(p, vec2(1.0)));
}

void main(void) {
  float progress = clamp(uProgress, 0.0, 1.0);
  vec2 p = vNormalizedCoord;
  
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
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
