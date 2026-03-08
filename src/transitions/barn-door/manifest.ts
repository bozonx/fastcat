import { Filter, GlProgram, Texture } from 'pixi.js';
import {
  clampNumber,
  easeInOutCubic,
  hexColorToRgb01,
  sanitizeTransitionColor,
} from '../core/registry';
import type { TransitionManifest } from '../core/registry';

export interface BarnDoorParams {
  mode: 'open' | 'close';
  edgeMode: 'gap' | 'blur';
  gap: number;
  gapColor: string;
  blur: number;
  blurMode: 'fixed' | 'scaled';
  angle: number;
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
uniform float uGap;
uniform float uBlur;
uniform float uUseGap;
uniform float uApplyToEdgeBlur;
uniform vec2 uAxis;
uniform vec3 uGapColor;
uniform float uAspect;
uniform float uMode; // 1.0 for open, 0.0 for close
uniform float uBlurMode; // 1.0 for scaled, 0.0 for fixed

void main(void) {
  vec2 uv = vNormalizedCoord;
  vec4 fromColor = texture(uFromTexture, uv);
  vec4 toColor = texture(uTexture, vTextureCoord);

  vec2 p = (uv - vec2(0.5, 0.5)) * vec2(uAspect, 1.0);
  
  float progress = clamp(uProgress, 0.0, 1.0);
  vec2 axis = normalize(uAxis);
  
  float gapHalf = uGap * 0.5;
  
  // distance from center along axis
  float dist = abs(dot(p, axis));
  
  float maxDist = 0.5 * (uAspect * abs(axis.x) + abs(axis.y));
  
  float threshold;
  float currentBlur;
  bool isToColorInside;
  
  if (uMode > 0.5) {
    // Open: reveals from center. At prog 0: threshold 0 (closed). At prog 1: threshold maxDist (fully open).
    threshold = maxDist * progress;
    // If scaled, further from closed state (prog 0) means more blur
    currentBlur = uBlurMode > 0.5 ? uBlur * progress : uBlur;
    isToColorInside = true; // distance < threshold means revealed toColor
  } else {
    // Close: closes from edges. At prog 0: threshold maxDist (fully open). At prog 1: threshold 0 (closed).
    threshold = maxDist * (1.0 - progress);
    // If scaled, further from closed state (prog 1) means more blur
    currentBlur = uBlurMode > 0.5 ? uBlur * (1.0 - progress) : uBlur;
    isToColorInside = false; // distance > threshold means incoming toColor from edges
  }
  
  float edge = threshold;
  float cutStart = edge - gapHalf;
  float cutEnd = edge + gapHalf;
  
  float blur = max(currentBlur, 0.00001);
  float blurMix = smoothstep(edge - blur, edge + blur, dist);

  if (uUseGap < 0.5) {
    vec4 mixedColor;
    if (isToColorInside) {
      mixedColor = mix(toColor, fromColor, blurMix);
    } else {
      mixedColor = mix(fromColor, toColor, blurMix);
    }
    
    if (uApplyToEdgeBlur > 0.5) {
      gl_FragColor = mixedColor;
    } else {
      if (isToColorInside) {
        gl_FragColor = dist < edge ? toColor : fromColor;
      } else {
        gl_FragColor = dist > edge ? toColor : fromColor;
      }
    }
    return;
  }

  if (dist < cutStart) {
    gl_FragColor = isToColorInside ? toColor : fromColor;
    return;
  }

  if (dist > cutEnd) {
    gl_FragColor = isToColorInside ? fromColor : toColor;
    return;
  }

  gl_FragColor = vec4(uGapColor, 1.0);
}
`;

function normalizeBarnDoorParams(params?: Record<string, unknown>): BarnDoorParams {
  const mode = params?.mode === 'close' ? 'close' : 'open';
  const edgeMode = params?.edgeMode === 'blur' ? 'blur' : 'gap';
  const blurMode = params?.blurMode === 'fixed' ? 'fixed' : 'scaled';

  return {
    mode,
    edgeMode,
    gap: clampNumber(params?.gap, 0, 0.2, 0.02),
    gapColor: sanitizeTransitionColor(params?.gapColor, '#000000'),
    blur: clampNumber(params?.blur, 0.0001, 0.2, 0.02),
    blurMode,
    angle: clampNumber(params?.angle, -180, 180, 0),
  };
}

export const barnDoorManifest: TransitionManifest<BarnDoorParams> = {
  type: 'barn-door',
  name: 'Barn Door',
  icon: 'i-heroicons-arrows-right-left',
  defaultDurationUs: 500_000,
  defaultParams: normalizeBarnDoorParams(),
  normalizeParams: normalizeBarnDoorParams,
  paramFields: [
    {
      key: 'mode',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramBarnDoorMode',
      options: [
        { value: 'open', labelKey: 'granVideoEditor.timeline.transition.barnDoorModeOpen' },
        { value: 'close', labelKey: 'granVideoEditor.timeline.transition.barnDoorModeClose' },
      ],
    },
    {
      key: 'edgeMode',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramWipeEdgeMode',
      options: [
        { value: 'gap', labelKey: 'granVideoEditor.timeline.transition.wipeEdgeModeGap' },
        { value: 'blur', labelKey: 'granVideoEditor.timeline.transition.wipeEdgeModeBlur' },
      ],
    },
    {
      key: 'blurMode',
      kind: 'select',
      labelKey: 'granVideoEditor.timeline.transition.paramBlurMode',
      options: [
        { value: 'scaled', labelKey: 'granVideoEditor.timeline.transition.blurModeScaled' },
        { value: 'fixed', labelKey: 'granVideoEditor.timeline.transition.blurModeFixed' },
      ],
    },
    {
      key: 'gap',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramGapSize',
      min: 0,
      max: 0.2,
      step: 0.005,
    },
    {
      key: 'gapColor',
      kind: 'color',
      labelKey: 'granVideoEditor.timeline.transition.paramGapColor',
    },
    {
      key: 'blur',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramWipeEdgeBlur',
      min: 0.0001,
      max: 0.2,
      step: 0.005,
    },
    {
      key: 'angle',
      kind: 'number',
      labelKey: 'granVideoEditor.timeline.transition.paramAngle',
      min: -180,
      max: 180,
      step: 1,
    },
  ],
  renderMode: 'shader',
  createFilter: () =>
    new Filter({
      glProgram: new GlProgram({ vertex, fragment }),
      resources: {
        uFromTexture: Texture.WHITE.source,
        barnDoorUniforms: {
          uProgress: { value: 0, type: 'f32' },
          uGap: { value: 0.02, type: 'f32' },
          uBlur: { value: 0.02, type: 'f32' },
          uUseGap: { value: 1, type: 'f32' },
          uApplyToEdgeBlur: { value: 0, type: 'f32' },
          uAxis: { value: [1, 0], type: 'vec2<f32>' },
          uGapColor: { value: [0, 0, 0], type: 'vec3<f32>' },
          uAspect: { value: 1.0, type: 'f32' },
          uMode: { value: 1.0, type: 'f32' },
          uBlurMode: { value: 1.0, type: 'f32' },
        },
      },
    }),
  updateFilter: (filter, context) => {
    const resources = (filter as any).resources;
    const uniforms = resources?.barnDoorUniforms?.uniforms;
    if (!uniforms) return;
    const progress =
      context.curve === 'bezier' ? easeInOutCubic(context.progress) : context.progress;
    const params = normalizeBarnDoorParams(context.params);

    const fromTex = context.fromTexture;
    const toTex = context.toTexture;
    const applyToEdgeBlur = context.edge === 'in' ? 1 : 0;

    const angleRad = params.angle * (Math.PI / 180);
    // angle 0 = vertical (axis x=1, y=0), angle 90 = horizontal (axis x=0, y=1)
    const axisX = Math.cos(angleRad);
    const axisY = Math.sin(angleRad);
    const rgb = hexColorToRgb01(params.gapColor);
    const useGap = params.edgeMode === 'gap';
    const aspect = context.toTexture ? context.toTexture.width / context.toTexture.height : 16 / 9;

    resources.uFromTexture = context.fromTexture?.source ?? Texture.WHITE.source;
    uniforms.uProgress = Math.max(0, Math.min(1, progress));
    uniforms.uGap = useGap ? params.gap : 0;
    uniforms.uBlur = params.blur;
    uniforms.uUseGap = useGap ? 1 : 0;
    uniforms.uApplyToEdgeBlur = !useGap && applyToEdgeBlur;
    uniforms.uAxis = [axisX, axisY];
    uniforms.uGapColor = [rgb.r, rgb.g, rgb.b];
    uniforms.uAspect = aspect;
    uniforms.uMode = params.mode === 'open' ? 1.0 : 0.0;
    uniforms.uBlurMode = params.blurMode === 'scaled' ? 1.0 : 0.0;
  },
  computeOutOpacity: () => 1,
  computeInOpacity: () => 1,
};
