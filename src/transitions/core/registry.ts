import type { Filter, Texture } from 'pixi.js';

export type TransitionType = string;

export type TransitionCurve = 'linear' | 'bezier';

export interface TransitionShaderContext {
  progress: number;
  curve: TransitionCurve;
  params?: Record<string, unknown>;
  fromTexture?: Texture;
  toTexture?: Texture;
}

export interface TransitionManifest<T = Record<string, never>> {
  type: TransitionType;
  name: string;
  icon: string;
  defaultDurationUs: number;
  defaultParams: T;
  renderMode?: 'opacity' | 'shader';
  createFilter?: () => Filter;
  updateFilter?: (filter: Filter, context: TransitionShaderContext) => void;
  /** Returns opacity [0..1] of the outgoing clip at `progress` [0..1] */
  computeOutOpacity: (progress: number, params: T, curve: TransitionCurve) => number;
  /** Returns opacity [0..1] of the incoming clip at `progress` [0..1] */
  computeInOpacity: (progress: number, params: T, curve: TransitionCurve) => number;
}

/** Cubic ease-in-out approximation for bezier transition curve */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const registry = new Map<TransitionType, TransitionManifest<any>>();

export function registerTransition<T>(manifest: TransitionManifest<T>): void {
  registry.set(manifest.type, manifest);
}

export function getTransitionManifest(type: TransitionType): TransitionManifest<any> | undefined {
  return registry.get(type);
}

export function getAllTransitionManifests(): TransitionManifest<any>[] {
  return Array.from(registry.values());
}
