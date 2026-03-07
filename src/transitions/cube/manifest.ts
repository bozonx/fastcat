import { Filter, GlProgram, Texture } from 'pixi.js';
import { easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface CubeParams {
  direction: 'left' | 'right' | 'up' | 'down';
  zoomMode: 'unzoom' | 'fixed';
  perspective: number;
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
uniform float uUnzoomAmount;
uniform float uPerspective;

bool inBounds(vec2 p) {
  return all(lessThan(vec2(0.0), p)) && all(lessThan(p, vec2(1.0)));
}

void main(void) {
  float progress = clamp(uProgress, 0.0, 1.0);
  vec2 uv = vNormalizedCoord;
  
  float unzoom = 0.3 * uUnzoomAmount;
  float uz = unzoom * 2.0 * (0.5 - abs(progress - 0.5));
  vec2 p = -uz * 0.5 + (1.0 + uz) * uv;
  
  vec2 fromP = vec2(-1.0);
  vec2 toP = vec2(-1.0);
  
  float P = mix(1.0, uPerspective, sin(progress * 3.14159265359));
  float fromWidth = max(0.0001, 1.0 - progress);
  float toWidth = max(0.0001, progress);

  if (uDirectionX < -0.5) { // Left
    // from is on the left [0, 1-progress]
    float u_from = p.x / fromWidth;
    float H_from = mix(1.0, P, u_from);
    fromP = vec2(u_from, (p.y - 0.5) / H_from + 0.5);
    
    // to is on the right [1-progress, 1]
    float u_to = (p.x - fromWidth) / toWidth;
    float H_to = mix(P, 1.0, u_to);
    toP = vec2(u_to, (p.y - 0.5) / H_to + 0.5);
    
  } else if (uDirectionX > 0.5) { // Right
    // from is on the right [progress, 1]
    float u_from = (p.x - toWidth) / fromWidth;
    float H_from = mix(P, 1.0, u_from);
    fromP = vec2(u_from, (p.y - 0.5) / H_from + 0.5);
    
    // to is on the left [0, progress]
    float u_to = p.x / toWidth;
    float H_to = mix(1.0, P, u_to);
    toP = vec2(u_to, (p.y - 0.5) / H_to + 0.5);
    
  } else if (uDirectionY < -0.5) { // Up
    // from is on top [0, 1-progress]
    float u_from = p.y / fromWidth;
    float H_from = mix(1.0, P, u_from);
    fromP = vec2((p.x - 0.5) / H_from + 0.5, u_from);
    
    // to is on bottom [1-progress, 1]
    float u_to = (p.y - fromWidth) / toWidth;
    float H_to = mix(P, 1.0, u_to);
    toP = vec2((p.x - 0.5) / H_to + 0.5, u_to);
    
  } else if (uDirectionY > 0.5) { // Down
    // from is on bottom [progress, 1]
    float u_from = (p.y - toWidth) / fromWidth;
    float H_from = mix(P, 1.0, u_from);
    fromP = vec2((p.x - 0.5) / H_from + 0.5, u_from);
    
    // to is on top [0, progress]
    float u_to = p.y / toWidth;
    float H_to = mix(1.0, P, u_to);
    toP = vec2((p.x - 0.5) / H_to + 0.5, u_to);
  }
  
  if (inBounds(fromP)) {
    gl_FragColor = texture(uFromTexture, fromP);
  } else if (inBounds(toP)) {
    gl_FragColor = texture(uTexture, vTextureCoord + (toP - uv) * vTexScale);
  } else {
    gl_FragColor = vec4(0.0);
  }
}
`;

function normalizeCubeParams(params?: Record<string, unknown>): CubeParams {
  const direction =
    params?.direction === 'right' ||
    params?.direction === 'up' ||
    params?.direction === 'down' ||
    params?.direction === 'left'
      ? params.direction
      : 'left';

  const zoomMode = params?.zoomMode === 'fixed' ? 'fixed' : 'unzoom';
  const perspective = typeof params?.perspective === 'number' ? params.perspective : 0.7;

  return { direction, zoomMode, perspective };
}

export const cubeTransitionManifest: TransitionManifest<CubeParams> = {
  type: 'cube' as any,
  name: 'Cube',
  icon: 'i-heroicons-cube',
  defaultDurationUs: 500_000,
  defaultParams: normalizeCubeParams(),
  normalizeParams: normalizeCubeParams,
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
    {
      key: 'zoomMode',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramMode',
      options: [
        { value: 'unzoom', labelKey: 'granVideoEditor.timeline.transition.modeUnzoom' },
        { value: 'fixed', labelKey: 'granVideoEditor.timeline.transition.modeFixed' },
      ],
    },
    {
      key: 'perspective',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramPerspective',
      min: 0.1,
      max: 3.0,
      step: 0.1,
    },
  ],
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        cubeUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uDirectionX: { value: 1, type: 'f32' },
          uDirectionY: { value: 0, type: 'f32' },
          uUnzoomAmount: { value: 1, type: 'f32' },
          uPerspective: { value: 0.7, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.cubeUniforms?.uniforms;
    if (!uniforms) return;
    const progress =
      context.curve === 'bezier' ? easeInOutCubic(context.progress) : context.progress;
    const params = normalizeCubeParams(context.params);
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
    uniforms.uUnzoomAmount = params.zoomMode === 'fixed' ? 0 : 1;
    uniforms.uPerspective = params.perspective;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
