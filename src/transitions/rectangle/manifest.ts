import { Filter, GlProgram, Texture } from 'pixi.js';
import { applyTransitionCurve, clampNumber } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface RectangleParams {
  blur: number;
  blurMode: 'fixed' | 'scaled';
  direction: 'from-center' | 'to-center';
  anchor: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  offsetX: number;
  offsetY: number;
  contentMode: 'reveal' | 'zoom';
}

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vNormalizedCoord;
out float vAspectRatio;
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
  vAspectRatio = uOutputTexture.x / uOutputTexture.y;
  vTexScale = uOutputFrame.zw * uInputSize.zw;
}
`;

const fragment = `
in vec2 vTextureCoord;
in vec2 vNormalizedCoord;
in float vAspectRatio;
in vec2 vTexScale;

uniform sampler2D uTexture;
uniform sampler2D uFromTexture;
uniform float uProgress;
uniform float uBlur;
uniform float uBlurMode;
uniform float uDirection;
uniform float uContentMode;
uniform vec2 uCenter;

// Function to calculate distance from a point to the edge of a rectangle
// centered at uCenter and with dimensions that scale with progress.
float rectDistance(vec2 p, vec2 center, vec2 size) {
  vec2 d = abs(p - center) - size;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

out vec4 finalColor;
void main(void) {
  vec2 uv = vNormalizedCoord;
  
  float progress = clamp(uProgress, 0.0, 1.0);
  float t = uDirection > 0.0 ? progress : (1.0 - progress);
  float blur = max(0.0001, uBlur * (uBlurMode > 0.5 ? t : 1.0));

  float reveal = 0.0;
  vec2 uvFrom = uv;
  vec2 coordTo = vTextureCoord;

  if (uContentMode > 0.5) {
    float scale = max(0.0001, t);
    vec2 uvScaled = uCenter + (uv - uCenter) / scale;
    
    if (uDirection > 0.0) {
      coordTo = vTextureCoord + (uvScaled - uv) * vTexScale;
    } else {
      uvFrom = uvScaled;
    }
    
    // Bounds of the scaled image
    vec2 bMin = uCenter - uCenter * scale;
    vec2 bMax = uCenter + (1.0 - uCenter) * scale;
    
    // Distance in aspect-corrected space
    vec2 p = uv;
    p.x *= vAspectRatio;
    vec2 boxMin = bMin;
    boxMin.x *= vAspectRatio;
    vec2 boxMax = bMax;
    boxMax.x *= vAspectRatio;
    
    vec2 boxCenter = (boxMin + boxMax) * 0.5;
    vec2 boxSize = (boxMax - boxMin) * 0.5;
    
    float dist = rectDistance(p, boxCenter, boxSize);
    
    reveal = 1.0 - smoothstep(-blur, blur, dist);
    if (uDirection < 0.0) {
      reveal = 1.0 - reveal;
    }
  } else {
    vec2 centered = uv - uCenter;
    centered.x *= vAspectRatio;
    
    // Calculate max dimensions needed to cover the entire screen from the center
    float maxDistX = max(uCenter.x, 1.0 - uCenter.x) * vAspectRatio;
    float maxDistY = max(uCenter.y, 1.0 - uCenter.y);
    vec2 maxSize = vec2(maxDistX, maxDistY);
    
    vec2 currentSize = maxSize * t;
    float dist = rectDistance(centered, vec2(0.0), currentSize);
    
    reveal = 1.0 - smoothstep(-blur, blur, dist);
    if (uDirection < 0.0) {
      reveal = 1.0 - reveal;
    }
  }

  vec4 fromColor = texture(uFromTexture, uvFrom);
  vec4 toColor = texture(uTexture, coordTo);

  finalColor = mix(fromColor, toColor, reveal);
}
`;

function normalizeRectangleParams(params?: Record<string, unknown>): RectangleParams {
  const anchor =
    typeof params?.anchor === 'string' &&
    ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(params.anchor)
      ? (params.anchor as RectangleParams['anchor'])
      : 'center';

  return {
    blur: clampNumber(params?.blur, 0.0001, 0.2, 0.015),
    blurMode: params?.blurMode === 'scaled' ? 'scaled' : 'fixed',
    direction: params?.direction === 'to-center' ? 'to-center' : 'from-center',
    anchor,
    offsetX: clampNumber(params?.offsetX, -100, 100, 0),
    offsetY: clampNumber(params?.offsetY, -100, 100, 0),
    contentMode: params?.contentMode === 'zoom' ? 'zoom' : 'reveal',
  };
}

export const rectangleManifest: TransitionManifest<RectangleParams> = {
  type: 'rectangle',
  name: 'Rectangle',
  nameKey: 'fastcat.transitions.rectangle.name',
  icon: 'i-heroicons-stop',
  defaultDurationUs: 600_000,
  defaultParams: normalizeRectangleParams(),
  normalizeParams: normalizeRectangleParams,
  paramFields: [
    {
      key: 'blur',
      kind: 'number',
      labelKey: 'fastcat.timeline.transition.paramRectangleBlur',
      min: 0.0001,
      max: 0.2,
      step: 0.0025,
    },
    {
      key: 'blurMode',
      kind: 'button-group',
      labelKey: 'fastcat.timeline.transition.paramBlurMode',
      options: [
        { value: 'fixed', labelKey: 'fastcat.timeline.transition.blurModeFixed' },
        { value: 'scaled', labelKey: 'fastcat.timeline.transition.blurModeScaled' },
      ],
    },
    {
      key: 'direction',
      kind: 'button-group',
      labelKey: 'fastcat.timeline.transition.paramDirection',
      options: [
        {
          value: 'from-center',
          labelKey: 'fastcat.timeline.transition.directionFromCenter',
        },
        { value: 'to-center', labelKey: 'fastcat.timeline.transition.directionToCenter' },
      ],
    },
    {
      key: 'anchor',
      kind: 'select',
      labelKey: 'fastcat.timeline.transition.paramAnchor',
      options: [
        { value: 'center', labelKey: 'fastcat.timeline.transition.anchorCenter' },
        { value: 'top-left', labelKey: 'fastcat.timeline.transition.anchorTopLeft' },
        { value: 'top-right', labelKey: 'fastcat.timeline.transition.anchorTopRight' },
        { value: 'bottom-left', labelKey: 'fastcat.timeline.transition.anchorBottomLeft' },
        {
          value: 'bottom-right',
          labelKey: 'fastcat.timeline.transition.anchorBottomRight',
        },
      ],
    },
    {
      key: 'offsetX',
      kind: 'number',
      labelKey: 'fastcat.timeline.transition.paramOffsetX',
      min: -100,
      max: 100,
      step: 1,
    },
    {
      key: 'offsetY',
      kind: 'number',
      labelKey: 'fastcat.timeline.transition.paramOffsetY',
      min: -100,
      max: 100,
      step: 1,
    },
    {
      key: 'contentMode',
      kind: 'button-group',
      labelKey: 'fastcat.timeline.transition.paramContentMode',
      options: [
        { value: 'reveal', labelKey: 'fastcat.timeline.transition.contentModeReveal' },
        { value: 'zoom', labelKey: 'fastcat.timeline.transition.contentModeZoom' },
      ],
    },
  ],
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        rectangleUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uBlur: { value: 0.015, type: 'f32' },
          uBlurMode: { value: 0, type: 'f32' },
          uDirection: { value: 1, type: 'f32' },
          uContentMode: { value: 0, type: 'f32' },
          uCenter: { value: [0.5, 0.5], type: 'vec2<f32>' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.rectangleUniforms?.uniforms;
    if (!uniforms) return;
    const progress = applyTransitionCurve(context.progress, context.curve);
    const params = normalizeRectangleParams(context.params);
    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uBlur = params.blur;
    uniforms.uBlurMode = params.blurMode === 'scaled' ? 1 : 0;
    uniforms.uDirection = params.direction === 'to-center' ? -1 : 1;
    uniforms.uContentMode = params.contentMode === 'zoom' ? 1 : 0;

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
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
