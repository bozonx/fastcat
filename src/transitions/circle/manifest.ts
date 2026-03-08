import { Filter, GlProgram, Texture } from 'pixi.js';
import { applyTransitionCurve, clampNumber } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface CircleParams {
  blur: number;
  blurMode: 'fixed' | 'scaled';
  direction: 'from-center' | 'to-center';
  anchor: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vNormalizedCoord;
out float vAspectRatio;

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
  vAspectRatio = uOutputTexture.x / uOutputTexture.y;
}
`;

const fragment = `
in vec2 vTextureCoord;
in vec2 vNormalizedCoord;
in float vAspectRatio;

uniform sampler2D uTexture;
uniform sampler2D uFromTexture;
uniform float uProgress;
uniform float uBlur;
uniform float uBlurMode;
uniform float uDirection;
uniform vec2 uCenter;
uniform vec2 uScale;

void main(void) {
  vec2 uv = vNormalizedCoord;
  vec2 centered = uv - uCenter;
  centered.x *= vAspectRatio;
  
  vec2 scale = max(vec2(0.001), uScale);
  centered /= scale;
  
  float distanceFromCenter = length(centered);
  
  vec2 corner0 = vec2(0.0, 0.0) - uCenter; corner0.x *= vAspectRatio; corner0 /= scale;
  vec2 corner1 = vec2(1.0, 0.0) - uCenter; corner1.x *= vAspectRatio; corner1 /= scale;
  vec2 corner2 = vec2(0.0, 1.0) - uCenter; corner2.x *= vAspectRatio; corner2 /= scale;
  vec2 corner3 = vec2(1.0, 1.0) - uCenter; corner3.x *= vAspectRatio; corner3 /= scale;
  
  float maxRadius = max(
    max(length(corner0), length(corner1)),
    max(length(corner2), length(corner3))
  );

  float progress = clamp(uProgress, 0.0, 1.0);
  float t = uDirection > 0.0 ? progress : (1.0 - progress);
  float radius = t * maxRadius;
  float blur = max(0.0001, uBlur * (uBlurMode > 0.5 ? t : 1.0));
  float reveal = 1.0 - smoothstep(radius - blur, radius + blur, distanceFromCenter);

  if (uDirection < 0.0) {
    reveal = 1.0 - reveal;
  }

  vec4 fromColor = texture(uFromTexture, uv);
  vec4 toColor = texture(uTexture, vTextureCoord);

  gl_FragColor = mix(fromColor, toColor, reveal);
}
`;

function normalizeCircleParams(params?: Record<string, unknown>): CircleParams {
  const anchor =
    typeof params?.anchor === 'string' &&
    ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(params.anchor)
      ? (params.anchor as CircleParams['anchor'])
      : 'center';

  return {
    blur: clampNumber(params?.blur, 0.0001, 0.2, 0.015),
    blurMode: params?.blurMode === 'scaled' ? 'scaled' : 'fixed',
    direction: params?.direction === 'to-center' ? 'to-center' : 'from-center',
    anchor,
    offsetX: clampNumber(params?.offsetX, -100, 100, 0),
    offsetY: clampNumber(params?.offsetY, -100, 100, 0),
    scaleX: clampNumber(params?.scaleX, 1, 1000, 100),
    scaleY: clampNumber(params?.scaleY, 1, 1000, 100),
  };
}

export const circleManifest: TransitionManifest<CircleParams> = {
  type: 'circle',
  name: 'Circle',
  icon: 'i-heroicons-stop-circle',
  defaultDurationUs: 600_000,
  defaultParams: normalizeCircleParams(),
  normalizeParams: normalizeCircleParams,
  paramFields: [
    {
      key: 'blur',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramCircleBlur',
      min: 0.0001,
      max: 0.2,
      step: 0.0025,
    },
    {
      key: 'blurMode',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramBlurMode',
      options: [
        { value: 'fixed', labelKey: 'granVideoEditor.timeline.transition.blurModeFixed' },
        { value: 'scaled', labelKey: 'granVideoEditor.timeline.transition.blurModeScaled' },
      ],
    },
    {
      key: 'direction',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramDirection',
      options: [
        {
          value: 'from-center',
          labelKey: 'granVideoEditor.timeline.transition.directionFromCenter',
        },
        { value: 'to-center', labelKey: 'granVideoEditor.timeline.transition.directionToCenter' },
      ],
    },
    {
      key: 'anchor',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramAnchor',
      options: [
        { value: 'center', labelKey: 'granVideoEditor.timeline.transition.anchorCenter' },
        { value: 'top-left', labelKey: 'granVideoEditor.timeline.transition.anchorTopLeft' },
        { value: 'top-right', labelKey: 'granVideoEditor.timeline.transition.anchorTopRight' },
        { value: 'bottom-left', labelKey: 'granVideoEditor.timeline.transition.anchorBottomLeft' },
        {
          value: 'bottom-right',
          labelKey: 'granVideoEditor.timeline.transition.anchorBottomRight',
        },
      ],
    },
    {
      key: 'offsetX',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramOffsetX',
      min: -100,
      max: 100,
      step: 1,
    },
    {
      key: 'offsetY',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramOffsetY',
      min: -100,
      max: 100,
      step: 1,
    },
    {
      key: 'scaleX',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramScaleX',
      min: 1,
      max: 1000,
      step: 1,
    },
    {
      key: 'scaleY',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramScaleY',
      min: 1,
      max: 1000,
      step: 1,
    },
  ],
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        circleUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uBlur: { value: 0.015, type: 'f32' },
          uBlurMode: { value: 0, type: 'f32' },
          uDirection: { value: 1, type: 'f32' },
          uCenter: { value: [0.5, 0.5], type: 'vec2<f32>' },
          uScale: { value: [1.0, 1.0], type: 'vec2<f32>' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.circleUniforms?.uniforms;
    if (!uniforms) return;
    const progress = applyTransitionCurve(context.progress, context.curve);
    const params = normalizeCircleParams(context.params);
    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uBlur = params.blur;
    uniforms.uBlurMode = params.blurMode === 'scaled' ? 1 : 0;
    uniforms.uDirection = params.direction === 'to-center' ? -1 : 1;

    let cx = 0.5;
    let cy = 0.5;
    let signX = 1;
    let signY = 1;

    if (params.anchor === 'top-left') {
      cx = 0;
      cy = 0;
    } else if (params.anchor === 'top-right') {
      cx = 1;
      cy = 0;
      signX = -1;
    } else if (params.anchor === 'bottom-left') {
      cx = 0;
      cy = 1;
      signY = -1;
    } else if (params.anchor === 'bottom-right') {
      cx = 1;
      cy = 1;
      signX = -1;
      signY = -1;
    }

    cx += (params.offsetX / 100) * signX;
    cy += (params.offsetY / 100) * signY;

    uniforms.uCenter = [cx, cy];
    uniforms.uScale = [params.scaleX / 100, params.scaleY / 100];
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
