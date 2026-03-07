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

const float PI = 3.14159265359;

bool inBounds(vec2 p) {
  return all(lessThan(vec2(0.0), p)) && all(lessThan(p, vec2(1.0)));
}

void main(void) {
  float progress = clamp(uProgress, 0.0, 1.0);
  vec2 uv = vNormalizedCoord;
  
  // В V8 Custom Filters: uTexture = FROM клип (уходящий), uFromTexture = TO клип (приходящий)
  vec4 toColor = texture(uFromTexture, uv);
  vec4 fromColor = texture(uTexture, vTextureCoord);
  
  if (progress >= 1.0) {
      gl_FragColor = toColor;
      return;
  }
  
  if (progress <= 0.0) {
      gl_FragColor = fromColor;
      return;
  }
  
  float angle = progress * PI / 2.0;
  float c = cos(angle);
  float s = sin(angle);
  
  vec2 p = vec2(0.0);
  float px = 0.0;
  float py = 0.0;
  float denom = 1.0;
  vec2 pfr = vec2(-1.0);
  
  // d: расстояние до камеры. Меньше d = сильнее перспектива
  float d = 1.5;
  
  if (uDirection < 0.5) { // down: залипает верхний край (y=0)
    p = uv - vec2(0.5, 0.0);
    // Обратное преобразование: вычисляем откуда взять пиксель из оригинального FROM-клипа
    // Так как FROM падает *назад* (от нас), мы инвертируем знак sin по сравнению с "на нас"
    denom = d * c + p.y * s;
    py = (p.y * d) / denom;
    px = p.x * (d - py * s) / d;
    pfr = vec2(px, py) + vec2(0.5, 0.0);
  } else if (uDirection < 1.5) { // up: залипает нижний край (y=1)
    p = uv - vec2(0.5, 1.0);
    denom = d * c - p.y * s;
    py = (p.y * d) / denom;
    px = p.x * (d + py * s) / d;
    pfr = vec2(px, py) + vec2(0.5, 1.0);
  } else if (uDirection < 2.5) { // right: залипает левый край (x=0)
    p = uv - vec2(0.0, 0.5);
    denom = d * c + p.x * s;
    px = (p.x * d) / denom;
    py = p.y * (d - px * s) / d;
    pfr = vec2(px, py) + vec2(0.0, 0.5);
  } else { // left: залипает правый край (x=1)
    p = uv - vec2(1.0, 0.5);
    denom = d * c - p.x * s;
    px = (p.x * d) / denom;
    py = p.y * (d + px * s) / d;
    pfr = vec2(px, py) + vec2(1.0, 0.5);
  }
  
  if (denom <= 0.0) {
      gl_FragColor = toColor;
      return;
  }
  
  if (inBounds(pfr)) {
      // Берем FROM-клип (uTexture) с учетом искажений
      vec4 cardColor = texture(uTexture, vTextureCoord + (pfr - uv) * vTexScale);
      
      // TO-клип (uFromTexture) служит фоном
      float outAlpha = cardColor.a + toColor.a * (1.0 - cardColor.a);
      if (outAlpha > 0.0) {
          vec3 outColor = (cardColor.rgb * cardColor.a + toColor.rgb * toColor.a * (1.0 - cardColor.a)) / outAlpha;
          gl_FragColor = vec4(outColor * outAlpha, outAlpha);
      } else {
          gl_FragColor = vec4(0.0);
      }
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
