import type { TransitionManifest, TransitionSpec } from './core/registry';
import barnDoorWgsl from '~shared/transitions/barn_door.wgsl?raw';
import blindsWgsl from '~shared/transitions/blinds.wgsl?raw';
import bloomWgsl from '~shared/transitions/bloom.wgsl?raw';
import cardSwapWgsl from '~shared/transitions/card_swap.wgsl?raw';
import clockWgsl from '~shared/transitions/clock.wgsl?raw';
import cubeWgsl from '~shared/transitions/cube.wgsl?raw';
import ellipseWgsl from '~shared/transitions/ellipse.wgsl?raw';
import fallingCardWgsl from '~shared/transitions/falling_card.wgsl?raw';
import motionBlurWgsl from '~shared/transitions/motion_blur.wgsl?raw';
import rectangleWgsl from '~shared/transitions/rectangle.wgsl?raw';
import slideWgsl from '~shared/transitions/slide.wgsl?raw';
import wipeWgsl from '~shared/transitions/wipe.wgsl?raw';
import zoomWgsl from '~shared/transitions/zoom.wgsl?raw';

// ---------------------------------------------------------------------------
// Runtime-agnostic helpers shared by web preview and native rendering/export.
// ---------------------------------------------------------------------------

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const transparent = () => 1;

function normalizeDirection(value: unknown): 'left' | 'right' | 'up' | 'down' {
  return value === 'right' || value === 'up' || value === 'down' || value === 'left'
    ? value
    : 'left';
}

function directionIndex(value: unknown): number {
  const direction = normalizeDirection(value);
  if (direction === 'right') return 1;
  if (direction === 'up') return 2;
  if (direction === 'down') return 3;
  return 0;
}

function normalizeTransitionColor(value: unknown, fallback = '#000000'): string {
  const raw = String(value ?? '')
    .trim()
    .replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[0] ?? '0';
    const g = raw[1] ?? '0';
    const b = raw[2] ?? '0';
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw}`.toLowerCase() : fallback;
}

/** Hex string → linear [0..1] rgb triple. */
function hexToRgb01(value: unknown, fallback = '#000000'): [number, number, number] {
  const hex = normalizeTransitionColor(value, fallback).slice(1);
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function qualitySamples(quality: unknown, low: number, med: number, high: number, ultra: number) {
  if (quality === 'low') return low;
  if (quality === 'high') return high;
  if (quality === 'ultra') return ultra;
  return med;
}

function qualityEdgeSamples(
  quality: unknown,
  low: number,
  med: number,
  high: number,
  ultra: number,
) {
  if (quality === 'low') return low;
  if (quality === 'high') return high;
  if (quality === 'ultra') return ultra;
  return med;
}

/**
 * Resolves effective blur quality from export/playback state and user settings.
 * Priority: export → still/paused frame (ultra) → explicit user quality → transition default.
 */
function resolveBlurQuality(
  options:
    | {
        isExport?: boolean;
        isPlaying?: boolean;
        previewBlurQuality?: string;
        idleSettled?: boolean;
      }
    | undefined,
  perTransitionQuality: unknown,
): string {
  if (options?.isExport) return 'ultra';
  // A *settled* still/paused frame renders at full fidelity, even if the user pinned a lower
  // quality for motion — so this must win over the explicit setting below (matches
  // resolvePreviewEffectQuality). While still interactive (`idleSettled === false`: scrubbing
  // or dragging transition params) we keep the cheaper motion quality and upgrade to ultra
  // only after the caller's settle debounce.
  if (options?.isPlaying === false && options?.idleSettled !== false) return 'ultra';
  const preview = options?.previewBlurQuality;
  if (preview && preview !== 'auto') return preview;
  // 'auto' or unset: fall back to the per-transition setting (default 'medium')
  return typeof perTransitionQuality === 'string' ? perTransitionQuality : 'medium';
}

/**
 * Static part of the motion-blur magnitude (`baseSpeed * motionBlur * factor`).
 * The renderers additionally scale blur by the curve's instantaneous speed
 * through the per-frame `uni.speed` uniform.
 */
function motionBlurConst(motionBlur: number, durationSec: number | undefined, factor = 0.05) {
  if (motionBlur > 0 && durationSec && durationSec > 0) {
    return (1 / durationSec) * motionBlur * factor;
  }
  return 0;
}

/** anchor + offset → normalized center, identical to the web rectangle/circle. */
function centerFromAnchor(params: Record<string, unknown>): [number, number] {
  const anchor = typeof params.anchor === 'string' ? params.anchor : 'center';
  const offsetX = clamp(finiteNumber(params.offsetX, 0), -100, 100) / 100;
  const offsetY = clamp(finiteNumber(params.offsetY, 0), -100, 100) / 100;

  if (anchor === 'top-left') return [offsetX, offsetY];
  if (anchor === 'top-right') return [1 - offsetX, offsetY];
  if (anchor === 'bottom-left') return [offsetX, 1 - offsetY];
  if (anchor === 'bottom-right') return [1 - offsetX, 1 - offsetY];
  return [0.5 + offsetX, 0.5 + offsetY];
}

function normalizeCircleParams(params?: Record<string, unknown>): Record<string, unknown> {
  const anchor =
    typeof params?.anchor === 'string' &&
    ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(params.anchor)
      ? params.anchor
      : 'center';

  return {
    blur: clamp(finiteNumber(params?.blur, 1.5), 0, 20),
    blurMode: params?.blurMode === 'scaled' ? 'scaled' : 'fixed',
    direction: params?.direction === 'to-center' ? 'to-center' : 'from-center',
    anchor,
    offsetX: clamp(finiteNumber(params?.offsetX, 0), -100, 100),
    offsetY: clamp(finiteNumber(params?.offsetY, 0), -100, 100),
    scaleX: clamp(finiteNumber(params?.scaleX, 100), 1, 1000),
    scaleY: clamp(finiteNumber(params?.scaleY, 100), 1, 1000),
    followScale: params?.followScale === true,
  };
}

function normalizeClockParams(params?: Record<string, unknown>): Record<string, unknown> {
  const direction = params?.direction as string;
  return {
    direction:
      direction === 'counterclockwise' || direction === 'symmetric' ? direction : 'clockwise',
    softness: clamp(finiteNumber(params?.softness, 0), 0, 100),
  };
}

function normalizeMotionBlurParams(params?: Record<string, unknown>): Record<string, unknown> {
  return {
    angle: clamp(finiteNumber(params?.angle, 0), -180, 180),
    motionBlur: clamp(finiteNumber(params?.motionBlur, 50), 0, 100),
    motionBlurMode: params?.motionBlurMode === 'bloom' ? 'bloom' : 'normal',
    brightness: clamp(finiteNumber(params?.brightness, 0), -10, 10),
    bloomThreshold: clamp(finiteNumber(params?.bloomThreshold, 0.7), 0, 1),
  };
}

function normalizeRectangleParams(params?: Record<string, unknown>): Record<string, unknown> {
  const anchor =
    typeof params?.anchor === 'string' &&
    ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(params.anchor)
      ? params.anchor
      : 'center';

  return {
    blur: clamp(finiteNumber(params?.blur, 1.5), 0, 20),
    blurMode: params?.blurMode === 'scaled' ? 'scaled' : 'fixed',
    direction: params?.direction === 'to-center' ? 'to-center' : 'from-center',
    anchor,
    offsetX: clamp(finiteNumber(params?.offsetX, 0), -100, 100),
    offsetY: clamp(finiteNumber(params?.offsetY, 0), -100, 100),
    contentMode: params?.contentMode === 'zoom' ? 'zoom' : 'reveal',
  };
}

function normalizeCubeParams(params?: Record<string, unknown>): Record<string, unknown> {
  const direction =
    params?.direction === 'right' ||
    params?.direction === 'up' ||
    params?.direction === 'down' ||
    params?.direction === 'left'
      ? params.direction
      : 'left';

  const zoomMode = params?.zoomMode === 'fixed' ? 'fixed' : 'unzoom';
  const perspective = typeof params?.perspective === 'number' ? params.perspective : 0.7;
  const gapSize = typeof params?.gapSize === 'number' ? Math.max(0, params.gapSize) : 0;
  const unzoomDistance =
    typeof params?.unzoomDistance === 'number' ? clamp(params.unzoomDistance, 0.0, 1.0) : 0.3;

  return { direction, zoomMode, perspective, gapSize, unzoomDistance };
}

// ---------------------------------------------------------------------------
// Reusable param-field fragments.
// ---------------------------------------------------------------------------

const anchorField = {
  kind: 'select' as const,
  key: 'anchor',
  labelKey: 'fastcat.timeline.transition.paramAnchor',
  options: [
    { value: 'center', labelKey: 'fastcat.timeline.transition.anchorCenter' },
    { value: 'top-left', labelKey: 'fastcat.timeline.transition.anchorTopLeft' },
    { value: 'top-right', labelKey: 'fastcat.timeline.transition.anchorTopRight' },
    { value: 'bottom-left', labelKey: 'fastcat.timeline.transition.anchorBottomLeft' },
    { value: 'bottom-right', labelKey: 'fastcat.timeline.transition.anchorBottomRight' },
  ],
};

const fromToCenterField = {
  kind: 'select' as const,
  key: 'direction',
  labelKey: 'fastcat.timeline.transition.paramDirection',
  options: [
    { value: 'from-center', labelKey: 'fastcat.timeline.transition.directionFromCenter' },
    { value: 'to-center', labelKey: 'fastcat.timeline.transition.directionToCenter' },
  ],
};

const blurModeField = {
  kind: 'button-group' as const,
  key: 'blurMode',
  labelKey: 'fastcat.timeline.transition.paramBlurMode',
  options: [
    { value: 'fixed', labelKey: 'fastcat.timeline.transition.blurModeFixed' },
    { value: 'scaled', labelKey: 'fastcat.timeline.transition.blurModeScaled' },
  ],
};

const offsetFields = [
  {
    kind: 'number' as const,
    key: 'offsetX',
    labelKey: 'fastcat.timeline.transition.paramOffsetX',
    min: -100,
    max: 100,
    step: 1,
  },
  {
    kind: 'number' as const,
    key: 'offsetY',
    labelKey: 'fastcat.timeline.transition.paramOffsetY',
    min: -100,
    max: 100,
    step: 1,
  },
];

// ---------------------------------------------------------------------------
// Manifests.
// ---------------------------------------------------------------------------

export const transitionManifests: TransitionManifest[] = [
  {
    type: 'dissolve',
    name: 'Dissolve',
    nameKey: 'fastcat.transitions.dissolve.name',
    icon: 'i-heroicons-arrows-right-left',
    defaultDurationUs: 500_000,
    defaultParams: {},
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    toTransitionSpec: () => ({ type: 'crossfade' }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'wipe',
    name: 'Wipe',
    nameKey: 'fastcat.transitions.wipe.name',
    icon: 'i-heroicons-bars-3-bottom-left',
    defaultDurationUs: 500_000,
    defaultParams: {
      direction: 'left',
      edgeMode: 'gap',
      gap: 0.02,
      gapColor: '#000000',
      blur: 2,
      angle: 0,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    paramFields: [
      {
        kind: 'select',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          { value: 'left', labelKey: 'fastcat.timeline.transition.directionLeft' },
          { value: 'right', labelKey: 'fastcat.timeline.transition.directionRight' },
          { value: 'up', labelKey: 'fastcat.timeline.transition.directionUp' },
          { value: 'down', labelKey: 'fastcat.timeline.transition.directionDown' },
        ],
      },
      {
        kind: 'button-group',
        key: 'edgeMode',
        labelKey: 'fastcat.timeline.transition.paramWipeEdgeMode',
        options: [
          { value: 'gap', labelKey: 'fastcat.timeline.transition.wipeEdgeModeGap' },
          { value: 'blur', labelKey: 'fastcat.timeline.transition.wipeEdgeModeBlur' },
        ],
      },
      {
        kind: 'number',
        key: 'gap',
        labelKey: 'fastcat.timeline.transition.paramGapSize',
        min: 0,
        max: 0.2,
        step: 0.005,
      },
      { kind: 'color', key: 'gapColor', labelKey: 'fastcat.timeline.transition.paramGapColor' },
      {
        kind: 'number',
        key: 'blur',
        labelKey: 'fastcat.timeline.transition.paramWipeEdgeBlur',
        min: 0,
        max: 20,
        step: 0.5,
      },
      {
        kind: 'number',
        key: 'angle',
        labelKey: 'fastcat.timeline.transition.paramAngle',
        min: -180,
        max: 180,
        step: 1,
      },
    ],
    toTransitionSpec: (params: Record<string, unknown>): TransitionSpec => {
      let baseAngle = 180; // 'left'
      if (params.direction === 'right') {
        baseAngle = 0;
      } else if (params.direction === 'up') {
        baseAngle = 270;
      } else if (params.direction === 'down') {
        baseAngle = 90;
      }
      const customAngle = clamp(finiteNumber(params.angle, 0), -180, 180);
      const angleRad = (((baseAngle + customAngle) % 360) * Math.PI) / 180;
      const useGap = params.edgeMode !== 'blur';
      const softness = clamp(finiteNumber(params.blur, 2) / 100, 0.0001, 1.0);
      const [r, g, b] = hexToRgb01(params.gapColor, '#000000');
      return {
        type: 'custom-wgsl',
        source: wipeWgsl,
        params: {
          p0: Math.cos(angleRad),
          p1: Math.sin(angleRad),
          p2: useGap ? clamp(finiteNumber(params.gap, 0.02), 0, 0.2) : 0,
          p3: softness,
          p4: useGap ? 1 : 0,
          p5: r,
          p6: g,
          p7: b,
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'slide',
    name: 'Slide',
    nameKey: 'fastcat.transitions.slide.name',
    icon: 'i-heroicons-arrows-right-left',
    defaultDurationUs: 500_000,
    defaultParams: {
      direction: 'left',
      gap: 0.02,
      gapColor: '#000000',
      motionBlur: 0,
      motionBlurMode: 'normal',
      blurQuality: 'medium',
      brightnessMode: 'normal',
      brightness: 0,
      bloomThreshold: 0.7,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    paramFields: [
      {
        kind: 'select',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          { value: 'left', labelKey: 'fastcat.transitions.slide.options.left' },
          { value: 'right', labelKey: 'fastcat.transitions.slide.options.right' },
          { value: 'up', labelKey: 'fastcat.transitions.slide.options.up' },
          { value: 'down', labelKey: 'fastcat.transitions.slide.options.down' },
        ],
      },
      {
        kind: 'number',
        key: 'gap',
        labelKey: 'fastcat.timeline.transition.paramGapSize',
        min: 0,
        max: 0.2,
        step: 0.005,
      },
      { kind: 'color', key: 'gapColor', labelKey: 'fastcat.timeline.transition.paramGapColor' },
      {
        kind: 'number',
        key: 'motionBlur',
        labelKey: 'fastcat.timeline.transition.paramMotionBlur',
        min: 0,
        max: 10,
        step: 0.1,
      },
      {
        kind: 'button-group',
        key: 'motionBlurMode',
        labelKey: 'fastcat.timeline.transition.paramMotionBlurMode',
        options: [
          { value: 'normal', labelKey: 'fastcat.timeline.transition.motionBlurModeNormal' },
          { value: 'bloom', labelKey: 'fastcat.timeline.transition.motionBlurModeBloom' },
        ],
      },
      {
        kind: 'button-group',
        key: 'brightnessMode',
        labelKey: 'fastcat.timeline.transition.paramBrightnessMode',
        options: [
          { value: 'normal', labelKey: 'fastcat.timeline.transition.brightnessModeNormal' },
          { value: 'bloom', labelKey: 'fastcat.timeline.transition.brightnessModeBloom' },
        ],
      },
      {
        kind: 'number',
        key: 'brightness',
        labelKey: 'fastcat.timeline.transition.paramBrightness',
        min: -10,
        max: 10,
        step: 0.1,
      },
      {
        kind: 'number',
        key: 'bloomThreshold',
        labelKey: 'fastcat.timeline.transition.paramBloomThreshold',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toTransitionSpec: (params: Record<string, unknown>): TransitionSpec => {
      const [r, g, b] = hexToRgb01(params.gapColor, '#000000');
      return {
        type: 'custom-wgsl',
        source: slideWgsl,
        params: {
          p0: directionIndex(params.direction),
          p1: clamp(finiteNumber(params.gap, 0.02), 0, 0.2),
          p2: r,
          p3: g,
          p4: b,
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'clock',
    name: 'Clock',
    nameKey: 'fastcat.transitions.clock.name',
    icon: 'i-heroicons-clock',
    defaultDurationUs: 600_000,
    defaultParams: normalizeClockParams(),
    normalizeParams: normalizeClockParams,
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    paramFields: [
      {
        kind: 'select',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          { value: 'clockwise', labelKey: 'fastcat.timeline.transition.directionClockwise' },
          {
            value: 'counterclockwise',
            labelKey: 'fastcat.timeline.transition.directionCounterclockwise',
          },
          { value: 'symmetric', labelKey: 'fastcat.timeline.transition.directionSymmetric' },
        ],
      },
      {
        kind: 'number',
        key: 'softness',
        labelKey: 'fastcat.timeline.transition.paramClockSoftness',
        min: 0,
        max: 100,
        step: 1,
      },
    ],
    toTransitionSpec: (params: Record<string, unknown>) => ({
      type: 'custom-wgsl',
      source: clockWgsl,
      params: {
        p0: params.direction === 'counterclockwise' ? -1 : params.direction === 'symmetric' ? 2 : 1,
        p1: clamp(finiteNumber(params.softness, 0) / 100, 0.0001, 0.5),
      },
    }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'motion-blur',
    name: 'Motion Blur',
    nameKey: 'fastcat.transitions.motion-blur.name',
    icon: 'i-heroicons-forward',
    defaultDurationUs: 500_000,
    defaultParams: normalizeMotionBlurParams(),
    normalizeParams: normalizeMotionBlurParams,
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    paramFields: [
      {
        kind: 'number',
        key: 'angle',
        labelKey: 'fastcat.timeline.transition.paramAngle',
        min: -180,
        max: 180,
        step: 1,
      },
      {
        kind: 'number',
        key: 'motionBlur',
        labelKey: 'fastcat.timeline.transition.paramMotionBlur',
        min: 0,
        max: 100,
        step: 1,
      },
      {
        kind: 'button-group',
        key: 'motionBlurMode',
        labelKey: 'fastcat.timeline.transition.paramMotionBlurMode',
        options: [
          { value: 'normal', labelKey: 'fastcat.timeline.transition.motionBlurModeNormal' },
          { value: 'bloom', labelKey: 'fastcat.timeline.transition.motionBlurModeBloom' },
        ],
      },
      {
        kind: 'number',
        key: 'brightness',
        labelKey: 'fastcat.timeline.transition.paramBrightness',
        min: -10,
        max: 10,
        step: 0.1,
      },
      {
        kind: 'number',
        key: 'bloomThreshold',
        labelKey: 'fastcat.timeline.transition.paramBloomThreshold',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toTransitionSpec: (
      params: Record<string, unknown>,
      durationSec?: number,
      options?: { isExport?: boolean; isPlaying?: boolean; previewBlurQuality?: string },
    ) => {
      const normalized = normalizeMotionBlurParams(params);
      const angle = finiteNumber(normalized.angle, 0);
      const rad = (angle * Math.PI) / 180;
      const quality = resolveBlurQuality(options, undefined);
      const samples = qualitySamples(quality, 8, 16, 32, 64);
      return {
        type: 'custom-wgsl',
        source: motionBlurWgsl,
        params: {
          p0: Math.cos(rad),
          p1: Math.sin(rad),
          p2: motionBlurConst(finiteNumber(normalized.motionBlur, 50), durationSec, 0.005),
          p3: samples,
          p4: normalized.motionBlurMode === 'bloom' ? 1 : 0,
          p5: finiteNumber(normalized.brightness, 0),
          p6: finiteNumber(normalized.bloomThreshold, 0.7),
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'barn-door',
    name: 'Barn Door',
    nameKey: 'fastcat.transitions.barn-door.name',
    icon: 'i-heroicons-arrows-right-left',
    defaultDurationUs: 500_000,
    defaultParams: {
      mode: 'open',
      edgeMode: 'gap',
      gap: 0.02,
      gapColor: '#000000',
      blur: 2,
      blurMode: 'scaled',
      angle: 0,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    paramFields: [
      {
        kind: 'button-group',
        key: 'mode',
        labelKey: 'fastcat.timeline.transition.paramBarnDoorMode',
        options: [
          { value: 'open', labelKey: 'fastcat.timeline.transition.barnDoorModeOpen' },
          { value: 'close', labelKey: 'fastcat.timeline.transition.barnDoorModeClose' },
        ],
      },
      {
        kind: 'button-group',
        key: 'edgeMode',
        labelKey: 'fastcat.timeline.transition.paramWipeEdgeMode',
        options: [
          { value: 'gap', labelKey: 'fastcat.timeline.transition.wipeEdgeModeGap' },
          { value: 'blur', labelKey: 'fastcat.timeline.transition.wipeEdgeModeBlur' },
        ],
      },
      {
        kind: 'button-group',
        key: 'blurMode',
        labelKey: 'fastcat.timeline.transition.paramBlurMode',
        options: [
          { value: 'scaled', labelKey: 'fastcat.timeline.transition.blurModeScaled' },
          { value: 'fixed', labelKey: 'fastcat.timeline.transition.blurModeFixed' },
        ],
      },
      {
        kind: 'number',
        key: 'gap',
        labelKey: 'fastcat.timeline.transition.paramGapSize',
        min: 0,
        max: 0.2,
        step: 0.005,
      },
      { kind: 'color', key: 'gapColor', labelKey: 'fastcat.timeline.transition.paramGapColor' },
      {
        kind: 'number',
        key: 'blur',
        labelKey: 'fastcat.timeline.transition.paramWipeEdgeBlur',
        min: 0,
        max: 20,
        step: 0.5,
      },
      {
        kind: 'number',
        key: 'angle',
        labelKey: 'fastcat.timeline.transition.paramAngle',
        min: -180,
        max: 180,
        step: 1,
      },
    ],
    toTransitionSpec: (params: Record<string, unknown>) => {
      const useGap = params.edgeMode !== 'blur';
      const angle = (clamp(finiteNumber(params.angle, 0), -180, 180) * Math.PI) / 180;
      const [r, g, b] = hexToRgb01(params.gapColor, '#000000');
      return {
        type: 'custom-wgsl',
        source: barnDoorWgsl,
        params: {
          p0: Math.cos(angle),
          p1: Math.sin(angle),
          p2: useGap ? clamp(finiteNumber(params.gap, 0.02), 0, 0.2) : 0,
          p3: clamp(finiteNumber(params.blur, 2) / 100, 0.0001, 0.2),
          p4: useGap ? 1 : 0,
          p5: r,
          p6: g,
          p7: b,
          p8: params.mode === 'close' ? 0 : 1,
          p9: params.blurMode === 'fixed' ? 0 : 1,
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'fade-to-black',
    name: 'Fade to Black',
    nameKey: 'fastcat.transitions.fade-to-black.name',
    icon: 'i-heroicons-moon',
    defaultDurationUs: 700_000,
    defaultParams: { color: '#000000' },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    paramFields: [
      { kind: 'color', key: 'color', labelKey: 'fastcat.timeline.transition.paramFadeColor' },
    ],
    toTransitionSpec: (params: Record<string, unknown>) => ({
      type: 'fade-through-color',
      color: normalizeTransitionColor(params.color, '#000000'),
    }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'circle',
    name: 'Circle',
    nameKey: 'fastcat.transitions.circle.name',
    icon: 'i-heroicons-stop-circle',
    defaultDurationUs: 600_000,
    defaultParams: normalizeCircleParams(),
    normalizeParams: normalizeCircleParams,
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    paramFields: [
      {
        kind: 'number',
        key: 'blur',
        labelKey: 'fastcat.timeline.transition.paramCircleBlur',
        min: 0,
        max: 20,
        step: 0.5,
      },
      blurModeField,
      fromToCenterField,
      anchorField,
      ...offsetFields,
      {
        kind: 'number',
        key: 'scaleX',
        labelKey: 'fastcat.timeline.transition.paramScaleX',
        min: 1,
        max: 1000,
        step: 1,
      },
      {
        kind: 'number',
        key: 'scaleY',
        labelKey: 'fastcat.timeline.transition.paramScaleY',
        min: 1,
        max: 1000,
        step: 1,
      },
      {
        kind: 'boolean',
        key: 'followScale',
        labelKey: 'fastcat.timeline.transition.paramFollowScale',
      },
    ],
    toTransitionSpec: (params: Record<string, unknown>) => {
      const center = centerFromAnchor(params);
      return {
        type: 'custom-wgsl',
        source: ellipseWgsl,
        params: {
          p0: clamp(finiteNumber(params.blur, 1.5) / 100, 0.0001, 0.2),
          p1: params.blurMode === 'scaled' ? 1 : 0,
          p2: params.direction === 'to-center' ? -1 : 1,
          p3: center[0],
          p4: center[1],
          p5: clamp(finiteNumber(params.scaleX, 100), 1, 1000) / 100,
          p6: clamp(finiteNumber(params.scaleY, 100), 1, 1000) / 100,
          p7: params.followScale === true ? 1 : 0,
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'rectangle',
    name: 'Rectangle',
    nameKey: 'fastcat.transitions.rectangle.name',
    icon: 'i-heroicons-stop',
    defaultDurationUs: 600_000,
    defaultParams: normalizeRectangleParams(),
    normalizeParams: normalizeRectangleParams,
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    paramFields: [
      {
        kind: 'number',
        key: 'blur',
        labelKey: 'fastcat.timeline.transition.paramRectangleBlur',
        min: 0,
        max: 20,
        step: 0.5,
      },
      blurModeField,
      {
        kind: 'button-group',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          { value: 'from-center', labelKey: 'fastcat.timeline.transition.directionFromCenter' },
          { value: 'to-center', labelKey: 'fastcat.timeline.transition.directionToCenter' },
        ],
      },
      anchorField,
      ...offsetFields,
      {
        kind: 'button-group',
        key: 'contentMode',
        labelKey: 'fastcat.timeline.transition.paramContentMode',
        options: [
          { value: 'reveal', labelKey: 'fastcat.timeline.transition.contentModeReveal' },
          { value: 'zoom', labelKey: 'fastcat.timeline.transition.contentModeZoom' },
        ],
      },
    ],
    toTransitionSpec: (params: Record<string, unknown>) => {
      const center = centerFromAnchor(params);
      return {
        type: 'custom-wgsl',
        source: rectangleWgsl,
        params: {
          p0: clamp(finiteNumber(params.blur, 1.5) / 100, 0.0001, 0.2),
          p1: params.blurMode === 'scaled' ? 1 : 0,
          p2: params.direction === 'to-center' ? -1 : 1,
          p3: params.contentMode === 'zoom' ? 1 : 0,
          p4: center[0],
          p5: center[1],
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'blinds',
    name: 'Blinds',
    nameKey: 'fastcat.transitions.blinds.name',
    icon: 'i-heroicons-bars-3',
    defaultDurationUs: 1_000_000,
    defaultParams: {
      angle: 0,
      stripCount: 10,
      blur: 0,
      blurQuality: 'medium',
      motionBlur: 0,
      motionBlurMode: 'normal',
      brightnessMode: 'normal',
      brightness: 0,
      bloomThreshold: 0.7,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    paramFields: [
      {
        kind: 'number',
        key: 'angle',
        labelKey: 'fastcat.timeline.transition.paramAngle',
        min: -360,
        max: 360,
        step: 1,
      },
      {
        kind: 'number',
        key: 'stripCount',
        labelKey: 'fastcat.timeline.transition.paramStripCount',
        min: 2,
        max: 100,
        step: 1,
      },
      {
        kind: 'number',
        key: 'blur',
        labelKey: 'fastcat.timeline.transition.paramPostBlur',
        min: 0,
        max: 100,
        step: 1,
      },
      {
        kind: 'number',
        key: 'motionBlur',
        labelKey: 'fastcat.timeline.transition.paramMotionBlur',
        min: 0,
        max: 100,
        step: 1,
      },
      {
        kind: 'button-group',
        key: 'motionBlurMode',
        labelKey: 'fastcat.timeline.transition.paramMotionBlurMode',
        options: [
          { value: 'normal', labelKey: 'fastcat.timeline.transition.motionBlurModeNormal' },
          { value: 'bloom', labelKey: 'fastcat.timeline.transition.motionBlurModeBloom' },
        ],
      },
      {
        kind: 'button-group',
        key: 'brightnessMode',
        labelKey: 'fastcat.timeline.transition.paramBrightnessMode',
        options: [
          { value: 'normal', labelKey: 'fastcat.timeline.transition.brightnessModeNormal' },
          { value: 'bloom', labelKey: 'fastcat.timeline.transition.brightnessModeBloom' },
        ],
      },
      {
        kind: 'number',
        key: 'brightness',
        labelKey: 'fastcat.timeline.transition.paramBrightness',
        min: -10,
        max: 10,
        step: 0.1,
      },
      {
        kind: 'number',
        key: 'bloomThreshold',
        labelKey: 'fastcat.timeline.transition.paramBloomThreshold',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toTransitionSpec: (
      params: Record<string, unknown>,
      durationSec?: number,
      options?: { isExport?: boolean; isPlaying?: boolean; previewBlurQuality?: string },
    ) => {
      const rad = (clamp(finiteNumber(params.angle, 0), -360, 360) * Math.PI) / 180;
      const q = resolveBlurQuality(options, params.blurQuality);
      const samples = qualitySamples(q, 8, 16, 32, 64);
      return {
        type: 'custom-wgsl',
        source: blindsWgsl,
        params: {
          p0: Math.cos(rad),
          p1: Math.sin(rad),
          p2: -Math.sin(rad),
          p3: Math.cos(rad),
          p4: Math.round(clamp(finiteNumber(params.stripCount, 10), 2, 100)),
          p5: clamp(finiteNumber(params.blur, 0), 0, 100),
          p6: samples,
          p7: motionBlurConst(clamp(finiteNumber(params.motionBlur, 0), 0, 100), durationSec),
          p8: params.motionBlurMode === 'bloom' ? 1 : 0,
          p9: params.brightnessMode === 'bloom' ? 1 : 0,
          p10: clamp(finiteNumber(params.brightness, 0), -10, 10),
          p11: clamp(finiteNumber(params.bloomThreshold, 0.7), 0, 1),
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'zoom',
    name: 'Zoom',
    nameKey: 'fastcat.transitions.zoom.name',
    icon: 'i-heroicons-magnifying-glass',
    defaultDurationUs: 500_000,
    defaultParams: {
      scale: 3.0,
      fromRotation: 0,
      toRotation: 0,
      blur: 20,
      blurQuality: 'medium',
      brightnessMode: 'normal',
      brightness: 0,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    paramFields: [
      {
        kind: 'number',
        key: 'scale',
        labelKey: 'fastcat.timeline.transition.paramScale',
        min: 1.1,
        max: 10.0,
        step: 0.1,
      },
      {
        kind: 'number',
        key: 'blur',
        labelKey: 'fastcat.timeline.transition.paramBlur',
        min: 0,
        max: 100,
        step: 1,
      },
      {
        kind: 'button-group',
        key: 'brightnessMode',
        labelKey: 'fastcat.timeline.transition.paramBrightnessMode',
        options: [
          { value: 'normal', labelKey: 'fastcat.timeline.transition.brightnessModeNormal' },
          { value: 'bloom', labelKey: 'fastcat.timeline.transition.brightnessModeBloom' },
        ],
      },
      {
        kind: 'slider',
        key: 'brightness',
        labelKey: 'fastcat.timeline.transition.paramBrightness',
        min: 0,
        max: 5,
        step: 0.1,
      },
      {
        kind: 'number',
        key: 'fromRotation',
        labelKey: 'fastcat.timeline.transition.paramFromRotation',
        min: -360,
        max: 360,
        step: 1,
      },
      {
        kind: 'number',
        key: 'toRotation',
        labelKey: 'fastcat.timeline.transition.paramToRotation',
        min: -360,
        max: 360,
        step: 1,
      },
    ],
    toTransitionSpec: (
      params: Record<string, unknown>,
      durationSec?: number,
      options?: { isExport?: boolean; isPlaying?: boolean; previewBlurQuality?: string },
    ) => {
      const q = resolveBlurQuality(options, params.blurQuality);
      const samples = qualitySamples(q, 8, 16, 32, 64);
      const aaSamples = qualityEdgeSamples(q, 1, 1, 8, 8);
      return {
        type: 'custom-wgsl',
        source: zoomWgsl,
        params: {
          p0: clamp(finiteNumber(params.scale, 3.0), 1.1, 10.0),
          p1: (clamp(finiteNumber(params.fromRotation, 0), -360, 360) * Math.PI) / 180,
          p2: (clamp(finiteNumber(params.toRotation, 0), -360, 360) * Math.PI) / 180,
          p3: clamp(finiteNumber(params.blur, 20), 0, 100),
          p4: samples,
          p5: params.brightnessMode === 'bloom' ? 1.0 : 0.0,
          p6: clamp(finiteNumber(params.brightness, 0), 0, 5),
          p7: aaSamples,
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'bloom',
    name: 'Bloom',
    nameKey: 'fastcat.transitions.bloom.name',
    icon: 'i-heroicons-sparkles',
    defaultDurationUs: 500_000,
    defaultParams: { brightness: 1.5, blurLevel: 1.0, mode: 'bloom' },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    paramFields: [
      {
        kind: 'button-group',
        key: 'mode',
        labelKey: 'fastcat.timeline.transition.paramMode',
        options: [
          { value: 'bloom', labelKey: 'fastcat.timeline.transition.modeBloom' },
          { value: 'normal', labelKey: 'fastcat.timeline.transition.modeNormal' },
        ],
      },
      {
        kind: 'slider',
        key: 'brightness',
        labelKey: 'fastcat.timeline.transition.paramBrightness',
        min: 0.1,
        max: 5.0,
        step: 0.1,
      },
      {
        kind: 'slider',
        key: 'blurLevel',
        labelKey: 'fastcat.timeline.transition.paramBlur',
        min: 0.0,
        max: 3.0,
        step: 0.1,
      },
    ],
    toTransitionSpec: (
      params: Record<string, unknown>,
      _durationSec?: number,
      options?: { isExport?: boolean; isPlaying?: boolean; previewBlurQuality?: string },
    ) => {
      const quality = resolveBlurQuality(options, 'medium');
      return {
        type: 'custom-wgsl',
        source: bloomWgsl,
        params: {
          p0: clamp(finiteNumber(params.brightness, 1.5), 0.1, 5.0),
          p1: clamp(finiteNumber(params.blurLevel, 1.0), 0.0, 3.0),
          p2: params.mode === 'normal' ? 0.0 : 1.0,
          p3: qualitySamples(quality, 5, 9, 17, 25),
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'cube',
    name: 'Cube',
    nameKey: 'fastcat.transitions.cube.name',
    icon: 'i-heroicons-cube',
    defaultDurationUs: 500_000,
    defaultParams: normalizeCubeParams(),
    normalizeParams: normalizeCubeParams,
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    paramFields: [
      {
        kind: 'select',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          { value: 'left', labelKey: 'fastcat.timeline.transition.directionLeft' },
          { value: 'right', labelKey: 'fastcat.timeline.transition.directionRight' },
          { value: 'up', labelKey: 'fastcat.timeline.transition.directionUp' },
          { value: 'down', labelKey: 'fastcat.timeline.transition.directionDown' },
        ],
      },
      {
        kind: 'button-group',
        key: 'zoomMode',
        labelKey: 'fastcat.timeline.transition.paramMode',
        options: [
          { value: 'unzoom', labelKey: 'fastcat.timeline.transition.modeUnzoom' },
          { value: 'fixed', labelKey: 'fastcat.timeline.transition.modeFixed' },
        ],
      },
      {
        kind: 'number',
        key: 'perspective',
        labelKey: 'fastcat.timeline.transition.paramPerspective',
        min: 0.1,
        max: 3.0,
        step: 0.1,
      },
      {
        kind: 'number',
        key: 'gapSize',
        labelKey: 'fastcat.timeline.transition.paramGapSize',
        min: 0,
        max: 0.5,
        step: 0.01,
      },
      {
        kind: 'slider',
        key: 'unzoomDistance',
        labelKey: 'fastcat.timeline.transition.paramUnzoomDistance',
        min: 0.0,
        max: 1.0,
        step: 0.05,
      },
    ],
    toTransitionSpec: (
      params: Record<string, unknown>,
      _durationSec?: number,
      options?: { isExport?: boolean; isPlaying?: boolean; previewBlurQuality?: string },
    ) => {
      const idx = directionIndex(params.direction); // 0 left, 1 right, 2 up, 3 down
      const dx = idx === 0 ? -1 : idx === 1 ? 1 : 0;
      const dy = idx === 2 ? -1 : idx === 3 ? 1 : 0;
      const q = resolveBlurQuality(options, params.blurQuality);
      return {
        type: 'custom-wgsl',
        source: cubeWgsl,
        params: {
          p0: dx,
          p1: dy,
          p2: params.zoomMode === 'fixed' ? 0 : 1,
          p3: clamp(finiteNumber(params.perspective, 0.7), 0.1, 3.0),
          p4: clamp(finiteNumber(params.gapSize, 0), 0, 0.5),
          p5: clamp(finiteNumber(params.unzoomDistance, 0.3), 0.0, 1.0),
          p6: qualityEdgeSamples(q, 1, 1, 8, 8),
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'card-swap',
    name: 'Card Swap',
    nameKey: 'fastcat.transitions.card-swap.name',
    icon: 'i-heroicons-arrow-path-rounded-square',
    defaultDurationUs: 500_000,
    defaultParams: {
      direction: 'horizontal',
      mode: 'zoom',
      slideOrder: 'normal',
      maxDarkness: 0.5,
      shadowSize: 0.2,
      shadowOpacity: 0.6,
      blurStrength: 0.5,
      blurQuality: 'medium',
      bloom: 0,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    paramFields: [
      {
        kind: 'select',
        key: 'mode',
        labelKey: 'fastcat.timeline.transition.paramCardSwapMode',
        options: [
          { value: 'zoom', labelKey: 'fastcat.timeline.transition.modeZoom' },
          { value: 'slide', labelKey: 'fastcat.timeline.transition.modeSlide' },
        ],
      },
      {
        kind: 'button-group',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          { value: 'horizontal', labelKey: 'fastcat.timeline.transition.directionHorizontal' },
          { value: 'vertical', labelKey: 'fastcat.timeline.transition.directionVertical' },
        ],
      },
      {
        kind: 'button-group',
        key: 'slideOrder',
        labelKey: 'fastcat.timeline.transition.paramSlideOrder',
        options: [
          { value: 'normal', labelKey: 'fastcat.timeline.transition.slideOrderNormal' },
          { value: 'reverse', labelKey: 'fastcat.timeline.transition.slideOrderReverse' },
        ],
      },
      {
        kind: 'slider',
        key: 'maxDarkness',
        labelKey: 'fastcat.timeline.transition.paramMaxDarkness',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        key: 'shadowSize',
        labelKey: 'fastcat.timeline.transition.paramShadowSize',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        key: 'shadowOpacity',
        labelKey: 'fastcat.timeline.transition.paramShadowOpacity',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        key: 'blurStrength',
        labelKey: 'fastcat.timeline.transition.paramBlurStrength',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        key: 'bloom',
        labelKey: 'fastcat.timeline.transition.paramBloom',
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
    toTransitionSpec: (
      params: Record<string, unknown>,
      durationSec?: number,
      options?: { isExport?: boolean; isPlaying?: boolean; previewBlurQuality?: string },
    ) => {
      const q = resolveBlurQuality(options, params.blurQuality);
      const samples = qualitySamples(q, 4, 8, 16, 32);
      const aaSamples = qualityEdgeSamples(q, 1, 1, 8, 8);
      return {
        type: 'custom-wgsl',
        source: cardSwapWgsl,
        params: {
          p0: params.direction === 'vertical' ? 0 : 1,
          p1: params.mode === 'slide' ? 1 : 0,
          p2: params.slideOrder === 'reverse' ? 1 : 0,
          p3: clamp(finiteNumber(params.maxDarkness, 0.5), 0, 1),
          p4: clamp(finiteNumber(params.shadowSize, 0.2), 0, 1),
          p5: clamp(finiteNumber(params.shadowOpacity, 0.6), 0, 1),
          p6: clamp(finiteNumber(params.blurStrength, 0.5), 0, 1),
          p7: samples,
          p8: clamp(finiteNumber(params.bloom, 0), 0, 1),
          p9: aaSamples,
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'falling-card',
    name: 'Falling Card',
    nameKey: 'fastcat.transitions.falling-card.name',
    icon: 'i-heroicons-square-3-stack-3d',
    defaultDurationUs: 500_000,
    defaultParams: {
      direction: 'down',
      depthDirection: 'backward',
      action: 'fall',
      edgeOverflow: 0,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    paramFields: [
      {
        kind: 'button-group',
        key: 'action',
        labelKey: 'fastcat.timeline.transition.paramAction',
        options: [
          { value: 'fall', labelKey: 'fastcat.timeline.transition.actionFall' },
          { value: 'rise', labelKey: 'fastcat.timeline.transition.actionRise' },
        ],
      },
      {
        kind: 'button-group',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          { value: 'down', labelKey: 'fastcat.timeline.transition.directionDown' },
          { value: 'up', labelKey: 'fastcat.timeline.transition.directionUp' },
          { value: 'left', labelKey: 'fastcat.timeline.transition.directionLeft' },
          { value: 'right', labelKey: 'fastcat.timeline.transition.directionRight' },
        ],
      },
      {
        kind: 'button-group',
        key: 'depthDirection',
        labelKey: 'fastcat.timeline.transition.paramDepthDirection',
        options: [
          { value: 'backward', labelKey: 'fastcat.timeline.transition.depthDirectionBackward' },
          { value: 'forward', labelKey: 'fastcat.timeline.transition.depthDirectionForward' },
        ],
      },
      {
        kind: 'slider',
        key: 'edgeOverflow',
        labelKey: 'fastcat.timeline.transition.paramEdgeOverflow',
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
    toTransitionSpec: (
      params: Record<string, unknown>,
      _durationSec?: number,
      options?: { isExport?: boolean; isPlaying?: boolean; previewBlurQuality?: string },
    ) => {
      // down=1, up=0, left=2, right=3 (matches the shared shader mapping)
      const d = params.direction;
      const dir = d === 'up' ? 0 : d === 'left' ? 2 : d === 'right' ? 3 : 1;
      const q = resolveBlurQuality(options, params.blurQuality);
      return {
        type: 'custom-wgsl',
        source: fallingCardWgsl,
        params: {
          p0: dir,
          p1: params.depthDirection === 'forward' ? -1 : 1,
          p2: params.action === 'rise' ? 1 : 0,
          // Edge bleed: 0 = card fits exactly inside the screen, 1 = near edge
          // bulges toward the viewer to ~2x screen size. Works in both directions.
          p3: clamp(finiteNumber(params.edgeOverflow, 0), 0, 1),
          p4: qualityEdgeSamples(q, 1, 1, 8, 8),
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
];

const transitionManifestByType = new Map(
  transitionManifests.map((manifest) => [manifest.type, manifest]),
);

export function getTransitionManifestByType(type: string): TransitionManifest | undefined {
  return transitionManifestByType.get(type);
}
