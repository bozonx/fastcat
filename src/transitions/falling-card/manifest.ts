import { Filter, GlProgram, Texture } from 'pixi.js';
import { easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface FallingCardParams {
  direction: 'down' | 'up' | 'left' | 'right';
  depthDirection: 'forward' | 'backward';
  action: 'fall' | 'rise';
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
uniform float uDepthDirection;
uniform float uAction;

const float PI = 3.14159265359;

bool inBounds(vec2 p) {
  return all(lessThan(vec2(0.0), p)) && all(lessThan(p, vec2(1.0)));
}

void main(void) {
  float progress = clamp(uProgress, 0.0, 1.0);
  vec2 uv = vNormalizedCoord;
  
  // В нашем движке: uTexture = TO (приходящий), uFromTexture = FROM (уходящий)
  vec4 toColor = texture(uTexture, vTextureCoord);
  vec4 fromColor = texture(uFromTexture, uv);
  
  if (progress >= 1.0) {
      gl_FragColor = toColor;
      return;
  }
  
  if (progress <= 0.0) {
      gl_FragColor = fromColor;
      return;
  }
  
  bool isRise = uAction > 0.5;
  float animProgress = isRise ? (1.0 - progress) : progress;
  
  float angle = animProgress * PI / 2.0;
  float c = cos(angle);
  float s = sin(angle);
  
  vec2 p = vec2(0.0);
  float px = 0.0;
  float py = 0.0;
  float denom = 1.0;
  vec2 pMoved = vec2(-1.0);
  
  float d = 1.5;
  // Когда карточка падает на зрителя (forward, uDepthDirection < 0.0), 
  // падающий край сильно приближается и увеличивается (выходит за экран).
  // Чтобы этого избежать, мы визуально отодвигаем всю карточку вглубь сцены.
  float zBase = (uDepthDirection < 0.0) ? (s * 0.8) : 0.0;
  float Z = 0.0;
  
  if (uDirection < 0.5) { // up: залипает верхний край (y=0)
    p = uv - vec2(0.5, 0.0);
    denom = d * c - uDepthDirection * p.y * s;
    if (denom > 0.0) {
        py = p.y * (d + zBase) / denom;
        Z = zBase + uDepthDirection * py * s;
        px = p.x * (d + Z) / d;
        pMoved = vec2(px, py) + vec2(0.5, 0.0);
    }
  } else if (uDirection < 1.5) { // down: залипает нижний край (y=1)
    p = uv - vec2(0.5, 1.0);
    denom = d * c + uDepthDirection * p.y * s;
    if (denom > 0.0) {
        py = p.y * (d + zBase) / denom;
        Z = zBase + uDepthDirection * (-py) * s;
        px = p.x * (d + Z) / d;
        pMoved = vec2(px, py) + vec2(0.5, 1.0);
    }
  } else if (uDirection < 2.5) { // left: залипает левый край (x=0)
    p = uv - vec2(0.0, 0.5);
    denom = d * c - uDepthDirection * p.x * s;
    if (denom > 0.0) {
        px = p.x * (d + zBase) / denom;
        Z = zBase + uDepthDirection * px * s;
        py = p.y * (d + Z) / d;
        pMoved = vec2(px, py) + vec2(0.0, 0.5);
    }
  } else { // right: залипает правый край (x=1)
    p = uv - vec2(1.0, 0.5);
    denom = d * c + uDepthDirection * p.x * s;
    if (denom > 0.0) {
        px = p.x * (d + zBase) / denom;
        Z = zBase + uDepthDirection * (-px) * s;
        py = p.y * (d + Z) / d;
        pMoved = vec2(px, py) + vec2(1.0, 0.5);
    }
  }
  
  if (denom <= 0.0) {
      gl_FragColor = isRise ? fromColor : toColor;
      return;
  }
  
  if (inBounds(pMoved)) {
      if (isRise) {
          // В режиме rise TO-клип поднимается, FROM-клип остается фоном
          vec4 movingColor = texture(uTexture, vTextureCoord + (pMoved - uv) * vTexScale);
          float outAlpha = movingColor.a + fromColor.a * (1.0 - movingColor.a);
          if (outAlpha > 0.0) {
              vec3 outColor = (movingColor.rgb * movingColor.a + fromColor.rgb * fromColor.a * (1.0 - movingColor.a)) / outAlpha;
              gl_FragColor = vec4(outColor * outAlpha, outAlpha);
          } else {
              gl_FragColor = vec4(0.0);
          }
      } else {
          // В режиме fall FROM-клип падает, TO-клип проступает фоном
          vec4 movingColor = texture(uFromTexture, pMoved);
          float outAlpha = movingColor.a + toColor.a * (1.0 - movingColor.a);
          if (outAlpha > 0.0) {
              vec3 outColor = (movingColor.rgb * movingColor.a + toColor.rgb * toColor.a * (1.0 - movingColor.a)) / outAlpha;
              gl_FragColor = vec4(outColor * outAlpha, outAlpha);
          } else {
              gl_FragColor = vec4(0.0);
          }
      }
  } else {
      gl_FragColor = isRise ? fromColor : toColor;
  }
}
`;

function normalizeFallingCardParams(params?: Record<string, unknown>): FallingCardParams {
  const dir = params?.direction as string;
  const depthDir = params?.depthDirection as string;
  const act = params?.action as string;
  const validDirs = ['down', 'up', 'left', 'right'];
  return {
    direction: validDirs.includes(dir) ? (dir as FallingCardParams['direction']) : 'down',
    depthDirection: depthDir === 'forward' ? 'forward' : 'backward',
    action: act === 'rise' ? 'rise' : 'fall',
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
      key: 'action',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramAction',
      options: [
        {
          value: 'fall',
          labelKey: 'granVideoEditor.timeline.transition.actionFall',
        },
        {
          value: 'rise',
          labelKey: 'granVideoEditor.timeline.transition.actionRise',
        },
      ],
    },
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
    {
      key: 'depthDirection',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramDepthDirection',
      options: [
        {
          value: 'backward',
          labelKey: 'granVideoEditor.timeline.transition.depthDirectionBackward',
        },
        {
          value: 'forward',
          labelKey: 'granVideoEditor.timeline.transition.depthDirectionForward',
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
          uDepthDirection: { value: 1, type: 'f32' },
          uAction: { value: 0, type: 'f32' },
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

    // down = 1 (anchor bottom, top falls down)
    // up = 0 (anchor top, bottom falls up)
    // right = 3 (anchor right, left falls right)
    // left = 2 (anchor left, right falls left)
    let dirFloat = 1;
    if (params.direction === 'up') dirFloat = 0;
    else if (params.direction === 'left') dirFloat = 2;
    else if (params.direction === 'right') dirFloat = 3;

    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uDirection = dirFloat;
    uniforms.uDepthDirection = params.depthDirection === 'forward' ? -1.0 : 1.0;
    uniforms.uAction = params.action === 'rise' ? 1.0 : 0.0;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
