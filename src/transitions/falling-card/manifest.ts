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

uniform sampler2D uSampler;
uniform sampler2D uFromTexture;
uniform vec4 uInputSize;
uniform float uProgress;
uniform int uDirection; // 0: down, 1: up, 2: right, 3: left

vec2 inverseProject(vec2 p, int dir, float progress, float aspect, float depth) {
    float theta = progress * 1.5707963; // up to 90 degrees
    float cos_t = cos(theta);
    float sin_t = sin(theta);
    
    float px, py, denom, local_y, local_x, orig_x, orig_y;
    
    if (dir == 0) { // down, pivot y=1
        px = (p.x - 0.5) * aspect;
        py = p.y - 1.0;
        denom = cos_t - py * sin_t / depth;
        if (denom <= 0.0) return vec2(-1.0);
        local_y = py / denom;
        orig_y = local_y + 1.0;
        local_x = px * (1.0 + local_y * sin_t / depth);
        orig_x = local_x / aspect + 0.5;
        return vec2(orig_x, orig_y);
    } 
    else if (dir == 1) { // up, pivot y=0
        px = (p.x - 0.5) * aspect;
        py = p.y - 0.0;
        denom = cos_t - py * sin_t / depth;
        if (denom <= 0.0) return vec2(-1.0);
        local_y = py / denom;
        orig_y = local_y + 0.0;
        local_x = px * (1.0 + local_y * sin_t / depth);
        orig_x = local_x / aspect + 0.5;
        return vec2(orig_x, orig_y);
    }
    else if (dir == 2) { // right, pivot x=1
        px = p.y - 0.5; 
        py = (p.x - 1.0) * aspect; 
        denom = cos_t - py * sin_t / depth;
        if (denom <= 0.0) return vec2(-1.0);
        local_y = py / denom; 
        orig_y = local_y / aspect + 1.0; 
        local_x = px * (1.0 + local_y * sin_t / depth); 
        orig_x = local_x + 0.5; 
        return vec2(orig_y, orig_x); 
    }
    else if (dir == 3) { // left, pivot x=0
        px = p.y - 0.5; 
        py = (p.x - 0.0) * aspect; 
        denom = cos_t - py * sin_t / depth;
        if (denom <= 0.0) return vec2(-1.0);
        local_y = py / denom; 
        orig_y = local_y / aspect + 0.0; 
        local_x = px * (1.0 + local_y * sin_t / depth); 
        orig_x = local_x + 0.5; 
        return vec2(orig_y, orig_x); 
    }
    return vec2(-1.0);
}

void main() {
  vec2 p = vNormalizedCoord;
  float aspect = uInputSize.x / uInputSize.y;
  float depth = 2.0; // perspective depth
  
  vec4 bgColor = texture(uSampler, vTextureCoord);
  
  if (uProgress >= 1.0) {
      gl_FragColor = bgColor;
      return;
  }
  
  vec2 pfr = inverseProject(p, uDirection, uProgress, aspect, depth);
  
  if (pfr.x >= 0.0 && pfr.x <= 1.0 && pfr.y >= 0.0 && pfr.y <= 1.0) {
      // It's inside the falling card
      // Add some shading to make it look 3D
      float shadow = mix(1.0, 0.3, uProgress);
      vec4 cardColor = texture(uFromTexture, pfr);
      cardColor.rgb *= shadow;
      
      // We assume the background (to texture) is underneath
      // Standard alpha blending
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
          uDirection: { value: 0, type: 'i32' },
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
    
    let dirInt = 0;
    if (params.direction === 'up') dirInt = 1;
    else if (params.direction === 'right') dirInt = 2;
    else if (params.direction === 'left') dirInt = 3;

    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uDirection = dirInt;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
