import type { Filter, Texture } from 'pixi.js';
import type { ParamControl, ParamOption } from '~/components/properties/params';

export type TransitionType = string;

export type TransitionMode = 'adjacent' | 'background' | 'transparent';

export type TransitionCurve = 'linear' | 'smooth' | 'ease-in' | 'ease-out';

export const DEFAULT_TRANSITION_MODE: TransitionMode = 'transparent';

export const DEFAULT_TRANSITION_CURVE: TransitionCurve = 'linear';

export const TRANSITION_CURVE_VALUES: TransitionCurve[] = ['linear', 'smooth', 'ease-in', 'ease-out'];

export interface TransitionShaderContext {
  progress: number;
  curve: TransitionCurve;
  curveParams?: {
    bulge?: number;
    offset?: number;
  };
  elapsedUs?: number;
  durationUs?: number;
  edge?: 'in' | 'out';
  params?: Record<string, unknown>;
  fromTexture?: Texture;
  toTexture?: Texture;
  /** Combined texture: from occupies left half [0..0.5], to occupies right half [0.5..1] in UV.x */
  combinedTexture?: Texture;
}

export type TransitionParamOption = ParamOption;

export type TransitionParamField = ParamControl;

export interface TransitionManifest<T = Record<string, any>> {
  type: TransitionType;
  name: string;
  nameKey?: string;
  descriptionKey?: string;
  icon: string;
  defaultDurationUs: number;
  defaultParams: T;
  normalizeParams?: (params?: Record<string, unknown>) => T;
  paramFields?: TransitionParamField[];
  renderMode?: 'opacity' | 'shader';
  createFilter?: () => Filter;
  updateFilter?: (filter: Filter, context: TransitionShaderContext) => void;
  /** Returns opacity [0..1] of the outgoing clip at `progress` [0..1] */
  computeOutOpacity: (progress: number, params: T, curve: TransitionCurve) => number;
  /** Returns opacity [0..1] of the incoming clip at `progress` [0..1] */
  computeInOpacity: (progress: number, params: T, curve: TransitionCurve) => number;
  isCustom?: boolean;
  baseType?: string;
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
  params?: Record<string, any>,
): number {
  const t = clampProgress(progress);

  if (curve === 'linear') {
    return t;
  }

  // Use provided params if available, otherwise use defaults based on curve type
  const bulge = params?.curveBulge ?? 0.8;
  const offset = params?.curveOffset ?? (curve === 'ease-in' ? 1.0 : curve === 'ease-out' ? 0.0 : 0.5);

  const x1 = offset * bulge;
  const x2 = 1 - (1 - offset) * bulge;

  return solveCubicBezier(t, x1, 0, x2, 1);
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

export function sanitizeTransitionColor(value: unknown, fallback = '#000000'): string {
  const raw = String(value ?? '')
    .trim()
    .replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[0] ?? '0';
    const g = raw[1] ?? '0';
    const b = raw[2] ?? '0';
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw}`.toLowerCase();
  }
  return fallback.toLowerCase();
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

const registry = new Map<TransitionType, TransitionManifest<any>>();

export function registerTransition<T>(manifest: TransitionManifest<T>): void {
  const existing = registry.get(manifest.type);
  if (existing && existing !== manifest) {
    console.warn(`[Transitions] Transition type \"${manifest.type}\" is already registered.`);
  }
  registry.set(manifest.type, manifest);
}

export function getTransitionManifest(type: TransitionType): TransitionManifest<any> | undefined {
  return registry.get(type);
}

export function normalizeTransitionParams<T = Record<string, any>>(
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
  return { ...(manifest.defaultParams as Record<string, unknown>), ...(params ?? {}) };
}

export function getAllTransitionManifests(): TransitionManifest<any>[] {
  return Array.from(registry.values());
}
