import { Filter, GlProgram, Texture } from 'pixi.js';
import { easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface ClockParams {
  direction: 'clockwise' | 'counterclockwise' | 'symmetric';
}

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vNormalizedCoord;

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
}
`;

const fragment = `
in vec2 vTextureCoord;
in vec2 vNormalizedCoord;

uniform sampler2D uTexture;
uniform sampler2D uFromTexture;
uniform float uProgress;
uniform float uDirection;

const float PI = 3.1415926535897932384626433832795;

void main(void) {
  vec2 uv = vNormalizedCoord;
  vec2 centered = uv - vec2(0.5, 0.5);

  float angle = atan(centered.x, -centered.y);
  if (angle < 0.0) {
    angle += PI * 2.0;
  }

  if (uDirection < 0.0) {
    angle = PI * 2.0 - angle;
    if (angle >= PI * 2.0) {
      angle -= PI * 2.0;
    }
  } else if (uDirection == 2.0) {
    // Symmetric
    if (angle > PI) {
      angle = PI * 2.0 - angle;
    }
    angle *= 2.0; // scale to 0..2PI range so normalizedAngle works out
  }

  float normalizedAngle = angle / (PI * 2.0);
  float progress = clamp(uProgress, 0.0, 1.0);
  float softness = 0.001;

  float reveal = smoothstep(progress - softness, progress + softness, normalizedAngle);

  vec4 fromColor = texture(uFromTexture, uv);
  vec4 toColor = texture(uTexture, vTextureCoord);

  gl_FragColor = mix(fromColor, toColor, 1.0 - reveal);
}
`;

function normalizeClockParams(params?: Record<string, unknown>): ClockParams {
  const direction = params?.direction as ClockParams['direction'];
  return {
    direction:
      direction === 'counterclockwise' || direction === 'symmetric' ? direction : 'clockwise',
  };
}

export const clockManifest: TransitionManifest<ClockParams> = {
  type: 'clock',
  name: 'Clock',
  icon: 'i-heroicons-clock',
  defaultDurationUs: 600_000,
  defaultParams: normalizeClockParams(),
  normalizeParams: normalizeClockParams,
  paramFields: [
    {
      key: 'direction',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramDirection',
      options: [
        {
          value: 'clockwise',
          labelKey: 'granVideoEditor.timeline.transition.directionClockwise',
        },
        {
          value: 'counterclockwise',
          labelKey: 'granVideoEditor.timeline.transition.directionCounterclockwise',
        },
        {
          value: 'symmetric',
          labelKey: 'granVideoEditor.timeline.transition.directionSymmetric',
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
        clockUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uDirection: { value: 1, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.clockUniforms?.uniforms;
    if (!uniforms) return;
    const progress =
      context.curve === 'bezier' ? easeInOutCubic(context.progress) : context.progress;
    const params = normalizeClockParams(context.params);
    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uDirection =
      params.direction === 'counterclockwise' ? -1 : params.direction === 'symmetric' ? 2 : 1;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
