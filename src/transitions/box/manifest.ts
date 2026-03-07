import { Filter, GlProgram, Texture } from 'pixi.js';
import { easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface BoxParams {
  direction: 'left' | 'right' | 'up' | 'down';
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
uniform float uDirectionX;
uniform float uDirectionY;

const float persp = 0.7;
const float unzoom = 0.3;

bool inBounds(vec2 p) {
  return all(lessThan(vec2(0.0), p)) && all(lessThan(p, vec2(1.0)));
}

vec2 xskew(vec2 p, float perspective, float center) {
  float x = mix(p.x, 1.0 - p.x, center);
  return (
    (
      vec2(x, (p.y - 0.5 * (1.0 - perspective) * x) / (1.0 + (perspective - 1.0) * x))
      - vec2(0.5 - distance(center, 0.5), 0.0)
    )
    * vec2(0.5 / distance(center, 0.5) * (center < 0.5 ? 1.0 : -1.0), 1.0)
    + vec2(center < 0.5 ? 0.0 : 1.0, 0.0)
  );
}

vec2 yskew(vec2 p, float perspective, float center) {
  float y = mix(p.y, 1.0 - p.y, center);
  return (
    (
      vec2((p.x - 0.5 * (1.0 - perspective) * y) / (1.0 + (perspective - 1.0) * y), y)
      - vec2(0.0, 0.5 - distance(center, 0.5))
    )
    * vec2(1.0, 0.5 / distance(center, 0.5) * (center < 0.5 ? 1.0 : -1.0))
    + vec2(0.0, center < 0.5 ? 0.0 : 1.0)
  );
}

void main(void) {
  float progress = clamp(uProgress, 0.0, 1.0);
  vec2 uv = vNormalizedCoord;
  
  float uz = unzoom * 2.0 * (0.5 - distance(0.5, progress));
  vec2 p = -uz * 0.5 + (1.0 + uz) * uv;
  
  float px = (uDirectionX < -0.5) ? 1.0 - p.x : p.x;
  float py = (uDirectionY < -0.5) ? 1.0 - p.y : p.y;
  vec2 mappedP = vec2(px, py);
  
  vec2 mappedFromP = vec2(-1.0);
  vec2 mappedToP = vec2(-1.0);
  
  if (abs(uDirectionX) > 0.5) {
    mappedFromP = xskew(
      (mappedP - vec2(progress, 0.0)) / vec2(1.0 - progress, 1.0),
      1.0 - mix(progress, 0.0, persp),
      0.0
    );
    mappedToP = xskew(
      mappedP / vec2(progress, 1.0),
      mix(pow(progress, 2.0), 1.0, persp),
      1.0
    );
  } else if (abs(uDirectionY) > 0.5) {
    mappedFromP = yskew(
      (mappedP - vec2(0.0, progress)) / vec2(1.0, 1.0 - progress),
      1.0 - mix(progress, 0.0, persp),
      0.0
    );
    mappedToP = yskew(
      mappedP / vec2(1.0, progress),
      mix(pow(progress, 2.0), 1.0, persp),
      1.0
    );
  }
  
  vec2 fromP = vec2(
    uDirectionX < -0.5 ? 1.0 - mappedFromP.x : mappedFromP.x,
    uDirectionY < -0.5 ? 1.0 - mappedFromP.y : mappedFromP.y
  );
  vec2 toP = vec2(
    uDirectionX < -0.5 ? 1.0 - mappedToP.x : mappedToP.x,
    uDirectionY < -0.5 ? 1.0 - mappedToP.y : mappedToP.y
  );
  
  if (inBounds(fromP)) {
    gl_FragColor = texture(uFromTexture, fromP);
  } else if (inBounds(toP)) {
    gl_FragColor = texture(uTexture, vTextureCoord + (toP - uv) * vTexScale);
  } else {
    gl_FragColor = vec4(0.0);
  }
}
`;

function normalizeBoxParams(params?: Record<string, unknown>): BoxParams {
  const direction =
    params?.direction === 'right' ||
    params?.direction === 'up' ||
    params?.direction === 'down' ||
    params?.direction === 'left'
      ? params.direction
      : 'left';

  return { direction };
}

export const boxTransitionManifest: TransitionManifest<BoxParams> = {
  type: 'box',
  name: 'Box',
  icon: 'i-heroicons-cube',
  defaultDurationUs: 500_000,
  defaultParams: normalizeBoxParams(),
  normalizeParams: normalizeBoxParams,
  paramFields: [
    {
      key: 'direction',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramDirection',
      options: [
        { value: 'left', labelKey: 'granVideoEditor.timeline.transition.directionLeft' },
        { value: 'right', labelKey: 'granVideoEditor.timeline.transition.directionRight' },
        { value: 'up', labelKey: 'granVideoEditor.timeline.transition.directionUp' },
        { value: 'down', labelKey: 'granVideoEditor.timeline.transition.directionDown' },
      ],
    },
  ],
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        boxUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uDirectionX: { value: 1, type: 'f32' },
          uDirectionY: { value: 0, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.boxUniforms?.uniforms;
    if (!uniforms) return;
    const progress =
      context.curve === 'bezier' ? easeInOutCubic(context.progress) : context.progress;
    const params = normalizeBoxParams(context.params);
    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;

    let dx = 0;
    let dy = 0;
    if (params.direction === 'left') dx = -1;
    else if (params.direction === 'right') dx = 1;
    else if (params.direction === 'up') dy = -1;
    else if (params.direction === 'down') dy = 1;

    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uDirectionX = dx;
    uniforms.uDirectionY = dy;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
