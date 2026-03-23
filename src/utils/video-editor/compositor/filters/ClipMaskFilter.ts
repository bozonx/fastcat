import { Filter, GlProgram, GpuProgram, type TextureSource } from 'pixi.js';

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
uniform sampler2D uMaskTexture;
uniform float uMode;
uniform float uInvert;

out vec4 finalColor;

void main(void) {
  vec4 color = texture(uTexture, vTextureCoord);
  vec4 maskColor = texture(uMaskTexture, vMaskCoord);

  float maskAlpha = uMode < 0.5
    ? maskColor.a
    : dot(maskColor.rgb, vec3(0.299, 0.587, 0.114)) * maskColor.a;

  if (uInvert > 0.5) {
    maskAlpha = 1.0 - maskAlpha;
  }

  finalColor = color * maskAlpha;
}
`;

const gpuSource = `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct ClipMaskUniforms {
  uMode: f32,
  uInvert: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;

@group(1) @binding(0) var<uniform> clipMaskUniforms: ClipMaskUniforms;
@group(1) @binding(1) var uMaskTexture: texture_2d<f32>;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) textureCoord: vec2<f32>,
  @location(1) maskCoord: vec2<f32>,
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32> {
  return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  return VSOutput(
    filterVertexPosition(aPosition),
    filterTextureCoord(aPosition),
    aPosition
  );
}

@fragment
fn mainFragment(
  @location(0) textureCoord: vec2<f32>,
  @location(1) maskCoord: vec2<f32>
) -> @location(0) vec4<f32> {
  let color = textureSample(uTexture, uSampler, textureCoord);
  let maskColor = textureSample(uMaskTexture, uSampler, maskCoord);

  var maskAlpha = select(
    dot(maskColor.rgb, vec3<f32>(0.299, 0.587, 0.114)) * maskColor.a,
    maskColor.a,
    clipMaskUniforms.uMode < 0.5
  );

  if (clipMaskUniforms.uInvert > 0.5) {
    maskAlpha = 1.0 - maskAlpha;
  }

  return color * maskAlpha;
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
    const gpuProgram = GpuProgram.from({
      vertex: {
        source: gpuSource,
        entryPoint: 'mainVertex',
      },
      fragment: {
        source: gpuSource,
        entryPoint: 'mainFragment',
      },
    });

    super({
      gpuProgram,
      glProgram,
      resources: {
        uMaskTexture: options.uMask,
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
    return this.resources.uMaskTexture;
  }
  set uMask(value: TextureSource) {
    this.resources.uMaskTexture = value;
  }
}
