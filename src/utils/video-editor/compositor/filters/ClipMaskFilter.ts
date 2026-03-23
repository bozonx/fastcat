import { Filter, GlProgram, type TextureSource } from 'pixi.js';

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vMaskCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
  // Sample the mask in normalized filter-area space (0..1 across the clip bounds)
  vMaskCoord = aPosition;
}
`;

const fragment = `
in vec2 vTextureCoord;
in vec2 vMaskCoord;

uniform sampler2D uTexture;
uniform sampler2D uMask;
uniform float uMode;
uniform float uInvert;

out vec4 finalColor;

void main(void) {
  vec4 color = texture(uTexture, vTextureCoord);
  vec4 maskColor = texture(uMask, vMaskCoord);

  float maskAlpha = uMode < 0.5
    ? maskColor.a
    : dot(maskColor.rgb, vec3(0.299, 0.587, 0.114)) * maskColor.a;

  if (uInvert > 0.5) {
    maskAlpha = 1.0 - maskAlpha;
  }

  finalColor = color * maskAlpha;
}
`;

export interface ClipMaskFilterOptions {
  uMask: TextureSource;
  uMode: number;
  uInvert: boolean;
}

export class ClipMaskFilter extends Filter {
  constructor(options: ClipMaskFilterOptions) {
    const glProgram = GlProgram.from({
      vertex,
      fragment,
      name: 'clip-mask-filter',
    });

    super({
      glProgram,
      resources: {
        uMask: options.uMask,
        clipMaskUniforms: {
          uMode: { value: options.uMode, type: 'f32' },
          uInvert: { value: options.uInvert ? 1.0 : 0.0, type: 'f32' },
        },
      },
    });
  }

  get uMode() {
    return this.resources.clipMaskUniforms.uniforms.uMode;
  }
  set uMode(value: number) {
    this.resources.clipMaskUniforms.uniforms.uMode = value;
  }

  get uInvert() {
    return this.resources.clipMaskUniforms.uniforms.uInvert > 0.5;
  }
  set uInvert(value: boolean) {
    this.resources.clipMaskUniforms.uniforms.uInvert = value ? 1.0 : 0.0;
  }

  get uMask() {
    return this.resources.uMask;
  }
  set uMask(value: TextureSource) {
    this.resources.uMask = value;
  }
}
