export type TransitionType = string;

export interface TransitionManifest<T = Record<string, never>> {
  type: TransitionType;
  name: string;
  icon: string;
  defaultDurationUs: number;
  defaultParams: T;
  /** Returns opacity [0..1] of the outgoing clip at `progress` [0..1] */
  computeOutOpacity: (progress: number, params: T, curve: 'linear' | 'bezier') => number;
  /** Returns opacity [0..1] of the incoming clip at `progress` [0..1] */
  computeInOpacity: (progress: number, params: T, curve: 'linear' | 'bezier') => number;
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
