export type TransitionType = string;

export interface TransitionManifest<T = Record<string, never>> {
  type: TransitionType;
  name: string;
  icon: string;
  defaultDurationUs: number;
  defaultParams: T;
  /** Returns opacity [0..1] of the outgoing clip at `progress` [0..1] (0 = transition start, 1 = transition end) */
  computeOutOpacity: (progress: number, params: T) => number;
  /** Returns opacity [0..1] of the incoming clip at `progress` [0..1] */
  computeInOpacity: (progress: number, params: T) => number;
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
