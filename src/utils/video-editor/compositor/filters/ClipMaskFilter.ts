import { Filter, GlProgram, Texture, type FilterSystem, type RenderSurface, type TextureSource } from 'pixi.js';

const vertex = `
    attribute vec2 aPosition;
    attribute vec2 aUV;

    uniform mat3 projectionMatrix;
    uniform mat3 filterMatrix;

    varying vec2 vUv;
    varying vec2 vMaskUv;

    void main() {
        gl_Position = vec4((projectionMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
        vUv = aUV;
        vMaskUv = (filterMatrix * vec3(aUV, 1.0)).xy;
    }
`;

const fragment = `
    precision highp float;

    varying vec2 vUv;
    varying vec2 vMaskUv;

    uniform sampler2D uSampler;
    uniform sampler2D uMask;
    uniform int uMode; // 0 = Alpha, 1 = Luma
    uniform bool uInvert;

    void main() {
        vec4 color = texture2D(uSampler, vUv);
        vec4 maskColor = texture2D(uMask, vMaskUv);

        float maskAlpha;
        if (uMode == 0) {
            maskAlpha = maskColor.a;
        } else {
            maskAlpha = dot(maskColor.rgb, vec3(0.299, 0.587, 0.114)) * maskColor.a;
        }

        if (uInvert) {
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
        uSampler: Texture.WHITE.source, // Placeholder, Pixi.js handles uSampler
        uMask: options.uMask.source,
        filterUniforms: {
          uMode: { value: options.uMode, type: 'i32' },
          uInvert: { value: options.uInvert ? 1.0 : 0.0, type: 'f32' },
        },
      },
    });
  }

  get uMode() {
    return this.resources.filterUniforms.uMode.value;
  }
  set uMode(value: number) {
    this.resources.filterUniforms.uMode.value = Math.round(value);
  }

  get uInvert() {
    return Boolean(this.resources.filterUniforms.uInvert.value);
  }
  set uInvert(value: boolean) {
    this.resources.filterUniforms.uInvert.value = value ? 1.0 : 0.0;
  }

  get uMask() {
    return this.resources.uMask;
  }
  set uMask(value: TextureSource) {
    this.resources.uMask = value;
  }
}
