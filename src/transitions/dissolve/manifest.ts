import { Filter, GlProgram, Texture } from 'pixi.js';
import { applyTransitionCurve } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DissolveParams {}

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

out vec4 finalColor;
void main(void) {
  vec2 uvFrom = vNormalizedCoord;
  vec2 uvTo = vTextureCoord;
  
  vec4 fromColor = texture(uFromTexture, uvFrom);
  vec4 toColor = texture(uTexture, uvTo);
  
  float progress = clamp(uProgress, 0.0, 1.0);
  finalColor = mix(fromColor, toColor, progress);
}
`;

export const dissolveManifest: TransitionManifest<DissolveParams> = {
  type: 'dissolve',
  name: 'Dissolve',
  nameKey: 'fastcat.transitions.dissolve.name',
  icon: 'i-heroicons-arrows-right-left',
  defaultDurationUs: 500_000,
  defaultParams: {},
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        dissolveUniforms: {
          uProgress: { value: 0, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.dissolveUniforms?.uniforms;
    if (!uniforms) return;

    const progress = applyTransitionCurve(context.progress, context.curve);
    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
  },
  computeOutOpacity: () => {
    // Return 1 so the sprite is fully opaque, 
    // allowing the shader to handle the cross-fade perfectly.
    return 1;
  },
  computeInOpacity: () => {
    return 1;
  },
};
