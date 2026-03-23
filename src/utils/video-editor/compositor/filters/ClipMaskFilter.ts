import { Filter, GlProgram, Texture, type FilterSystem, type RenderSurface, type TextureSource } from 'pixi.js';

const vertex = `
    attribute vec2 aPosition;
    attribute vec2 aUV;

    uniform mat3 projectionMatrix;

    varying vec2 vUv;

    void main() {
        gl_Position = vec4((projectionMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
        vUv = aUV;
    }
`;

const fragment = `
    precision highp float;

    varying vec2 vUv;

    uniform sampler2D uSampler;
    uniform sampler2D uMask;
    uniform float uMode; // 0.0 = Alpha, 1.0 = Luma
    uniform float uInvert; // 0.0 = False, 1.0 = True

    void main() {
        vec4 color = texture2D(uSampler, vUv);
        vec4 maskColor = texture2D(uMask, vUv);

        float maskAlpha;
        if (uMode < 0.5) {
            maskAlpha = maskColor.a;
        } else {
            maskAlpha = dot(maskColor.rgb, vec3(0.299, 0.587, 0.114)) * maskColor.a;
        }

        if (uInvert > 0.5) {
            maskAlpha = 1.0 - maskAlpha;
        }

        gl_FragColor = color * maskAlpha;
    }
`;

export interface ClipMaskFilterOptions {
  uMask: Texture;
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
        filterUniforms: {
          uMode: { value: options.uMode, type: 'f32' },
          uInvert: { value: options.uInvert ? 1.0 : 0.0, type: 'f32' },
        },
      },
    });
  }

  get uMode() {
    return this.resources.filterUniforms.uMode.value;
  }
  set uMode(value: number) {
    this.resources.filterUniforms.uMode.value = value;
  }

  get uInvert() {
    return this.resources.filterUniforms.uInvert.value > 0.5;
  }
  set uInvert(value: boolean) {
    this.resources.filterUniforms.uInvert.value = value ? 1.0 : 0.0;
  }

  get uMask() {
    return this.resources.uMask;
  }
  set uMask(value: any) {
    this.resources.uMask = value;
  }
}
