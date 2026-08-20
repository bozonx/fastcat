import { normalizeHexColor } from '~/utils/color';
import { createDevLogger } from '~/utils/dev-logger';
import type { Filter, Texture } from 'pixi.js';
import type { ParamControl, ParamOption } from '~/types/params';
import { getTransitionManifestByType, transitionManifests } from '../manifests';
const log = createDevLogger('registry');

export type TransitionType = string;

export type TransitionMode = 'adjacent' | 'background' | 'transparent';

export type TransitionCurve = 'linear' | 'smooth' | 'ease-in' | 'ease-out';
export type TransitionRenderer = 'pixi' | 'wgpu';

export interface TransitionSpec {
  type: string;
  [key: string]: unknown;
}

export const DEFAULT_TRANSITION_MODE: TransitionMode = 'transparent';

export const DEFAULT_TRANSITION_CURVE: TransitionCurve = 'linear';

export const TRANSITION_CURVE_VALUES: TransitionCurve[] = [
  'linear',
  'smooth',
  'ease-in',
  'ease-out',
];

export interface TransitionShaderContext {
  progress: number;
  curve: TransitionCurve;
  curveParams?: {
    bulge?: number;
    offset?: number;
  };
  elapsedTicks?: number;
  durationTicks?: number;
  edge?: 'in' | 'out';
  params?: Record<string, unknown>;
  fromTexture?: Texture;
  toTexture?: Texture;
  /** Combined texture: from occupies left half [0..0.5], to occupies right half [0.5..1] in UV.x */
  combinedTexture?: Texture;
}

export type TransitionParamOption = ParamOption;

export type TransitionParamField = ParamControl;

export interface TransitionManifest<T = Record<string, unknown>> {
  type: TransitionType;
  name: string;
  nameKey?: string;
  descriptionKey?: string;
  icon: string;
  defaultDurationTicks: number;
  defaultParams: T;
  normalizeParams?: (params?: Record<string, unknown>) => T;
  paramFields?: TransitionParamField[];
  renderMode?: 'opacity' | 'shader';
  renderer?: TransitionRenderer;
  createFilter?: () => Filter;
  updateFilter?: (filter: Filter, context: TransitionShaderContext) => void;
  toTransitionSpec?: (
    params: T,
    durationSec?: number,
    options?: {
      isExport?: boolean;
      isPlaying?: boolean;
      previewBlurQuality?: string;
      /** When `false`, the paused frame is still interactive (scrub / param drag) so blur
       * stays at the user motion quality instead of upgrading to ultra. Defaults to settled. */
      idleSettled?: boolean;
    },
  ) => TransitionSpec;
  supportedModes?: TransitionMode[];
  /** Returns opacity [0..1] of the outgoing clip at `progress` [0..1] */
  computeOutOpacity: (progress: number, params: T, curve: TransitionCurve) => number;
  /** Returns opacity [0..1] of the incoming clip at `progress` [0..1] */
  computeInOpacity: (progress: number, params: T, curve: TransitionCurve) => number;
  isCustom?: boolean;
  baseType?: string;
  experimental?: boolean;
}

/** Cubic ease-in-out approximation for bezier transition curve */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function solveCubicBezier(t: number, x1: number, y1: number, x2: number, y2: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (x1 === y1 && x2 === y2) return t;

  let guess = t;
  for (let i = 0; i < 5; i++) {
    const cx = 3.0 * x1;
    const bx = 3.0 * (x2 - x1) - cx;
    const ax = 1.0 - cx - bx;
    const currentX = ((ax * guess + bx) * guess + cx) * guess;
    const currentSlope = (3.0 * ax * guess + 2.0 * bx) * guess + cx;
    if (currentSlope === 0.0) break;
    guess -= (currentX - t) / currentSlope;
  }

  guess = Math.max(0, Math.min(1, guess));

  const cy = 3.0 * y1;
  const by = 3.0 * (y2 - y1) - cy;
  const ay = 1.0 - cy - by;
  return ((ay * guess + by) * guess + cy) * guess;
}

/**
 * Applies an interpolation curve to the progress value.
 * @param progress Value from 0 to 1
 * @param curve Curve type
 * @param params Optional parameters (curveBulge [0..1], curveOffset [0..1])
 */
export function applyTransitionCurve(
  progress: number,
  curve: TransitionCurve,
  params?: Record<string, unknown>,
): number {
  const t = clampProgress(progress);

  if (curve === 'linear') {
    return t;
  }

  // Use provided params if available, otherwise use defaults based on curve type
  const bulge = (params?.curveBulge as number | undefined) ?? 0.8;
  const offset =
    (params?.curveOffset as number | undefined) ??
    (curve === 'ease-in' ? 1.0 : curve === 'ease-out' ? 0.0 : 0.5);

  const x1 = offset * bulge;
  const x2 = 1 - (1 - offset) * bulge;

  return solveCubicBezier(t, x1, 0, x2, 1);
}

export function getTransitionCurveSpeed(
  progress: number,
  curve: TransitionCurve,
  params?: Record<string, unknown>,
): number {
  const delta = 0.001;
  const start = Math.max(0, progress - delta);
  const end = Math.min(1, progress + delta);
  if (end <= start) return 1;

  return Math.max(
    0,
    (applyTransitionCurve(end, curve, params) - applyTransitionCurve(start, curve, params)) /
      (end - start),
  );
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

export function sanitizeTransitionColor(value: unknown, fallback = '#000000'): string {
  return normalizeHexColor(value, fallback);
}

export function hexColorToRgb01(color: string): { r: number; g: number; b: number } {
  const normalized = sanitizeTransitionColor(color);
  const hex = normalized.slice(1);
  const parsed = Number.parseInt(hex, 16);
  if (!Number.isFinite(parsed)) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: ((parsed >> 16) & 0xff) / 255,
    g: ((parsed >> 8) & 0xff) / 255,
    b: (parsed & 0xff) / 255,
  };
}

export function normalizeTransitionMode(value: unknown): TransitionMode {
  if (value === 'adjacent' || value === 'background' || value === 'transparent') {
    return value;
  }

  if (value === 'transition' || value === 'blend_previous') {
    return 'adjacent';
  }

  if (value === 'fade' || value === 'composite' || value === 'blend') {
    return 'background';
  }

  if (value === 'none' || value === 'opacity' || value === 'alpha') {
    return 'transparent';
  }

  return DEFAULT_TRANSITION_MODE;
}

export function normalizeTransitionCurve(value: unknown): TransitionCurve {
  return typeof value === 'string' && TRANSITION_CURVE_VALUES.includes(value as TransitionCurve)
    ? (value as TransitionCurve)
    : DEFAULT_TRANSITION_CURVE;
}

const registry = new Map<TransitionType, TransitionManifest<Record<string, unknown>>>();

export function registerTransition<T>(manifest: TransitionManifest<T>): void {
  const existing = registry.get(manifest.type);
  if (existing && existing !== manifest) {
    log.warn(`[Transitions] Transition type "${manifest.type}" is already registered.`);
  }
  registry.set(manifest.type, manifest as TransitionManifest<Record<string, unknown>>);
}

export function getTransitionManifest(
  type: TransitionType,
): TransitionManifest<Record<string, unknown>> | undefined {
  const manifest = getTransitionManifestByType(type);
  if (manifest) {
    return manifest as TransitionManifest<Record<string, unknown>>;
  }

  return registry.get(type);
}

export function normalizeTransitionParams<T = Record<string, unknown>>(
  type: TransitionType,
  params?: Record<string, unknown>,
): T | Record<string, unknown> | undefined {
  const manifest = getTransitionManifest(type);
  if (!manifest) {
    return params ? { ...params } : undefined;
  }
  if (manifest.normalizeParams) {
    return manifest.normalizeParams(params);
  }

  const defaults = manifest.defaultParams as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...defaults };
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = params?.[key];
    const field = manifest.paramFields?.find((candidate) => candidate.key === key);

    if (typeof fallback === 'number') {
      const numericField =
        field?.kind === 'number' || field?.kind === 'slider' || field?.kind === 'knob'
          ? field
          : undefined;
      normalized[key] = clampNumber(
        value,
        typeof numericField?.min === 'number' ? numericField.min : Number.NEGATIVE_INFINITY,
        typeof numericField?.max === 'number' ? numericField.max : Number.POSITIVE_INFINITY,
        fallback,
      );
      continue;
    }

    if (typeof fallback === 'boolean') {
      normalized[key] = typeof value === 'boolean' ? value : fallback;
      continue;
    }

    if (typeof fallback === 'string') {
      if (field?.kind === 'color') {
        normalized[key] = sanitizeTransitionColor(value, fallback);
        continue;
      }

      const allowedValues =
        field?.kind === 'select' || field?.kind === 'button-group'
          ? field.options.map((option) => option.value)
          : undefined;
      normalized[key] =
        typeof value === 'string' && (!allowedValues || allowedValues.includes(value))
          ? value
          : fallback;
    }
  }

  return normalized;
}

export function resolveAppliedTransitionPreset(type: TransitionType): {
  type: TransitionType;
  params?: Record<string, unknown>;
} {
  const manifest = getTransitionManifest(type);
  if (!manifest?.isCustom || !manifest.baseType) {
    return { type };
  }

  return {
    type: manifest.baseType,
    params: normalizeTransitionParams(
      manifest.baseType,
      manifest.defaultParams as Record<string, unknown>,
    ) as Record<string, unknown> | undefined,
  };
}

export function getAllTransitionManifests(): TransitionManifest<Record<string, unknown>>[] {
  const custom = Array.from(registry.values()).filter((manifest) => manifest.isCustom);
  return [...transitionManifests, ...custom] as TransitionManifest<Record<string, unknown>>[];
}
