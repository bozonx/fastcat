import type { Filter } from 'pixi.js';

export type EffectType = string;

export interface EffectManifest<T = Record<string, any>> {
  type: EffectType;
  name: string;
  description: string;
  icon: string;
  defaultValues: T;
  controls: EffectControl<T>[];
  createFilter: () => Filter;
  updateFilter: (filter: Filter, values: T) => void;
}

export type EffectControl<T> =
  | {
      kind: 'slider';
      key: keyof T;
      label: string;
      min: number;
      max: number;
      step: number;
      format?: (v: number) => string;
    }
  | { kind: 'toggle'; key: keyof T; label: string };

export interface BaseClipEffect {
  id: string;
  type: EffectType;
  enabled: boolean;
}

export type ClipEffect<T = Record<string, any>> = BaseClipEffect & T;

// Registry
const effectsRegistry = new Map<EffectType, EffectManifest<any>>();

export function registerEffect<T>(manifest: EffectManifest<T>) {
  effectsRegistry.set(manifest.type, manifest);
}

export function getEffectManifest(type: EffectType): EffectManifest<any> | undefined {
  return effectsRegistry.get(type);
}

export function getAllEffectManifests(): EffectManifest<any>[] {
  return Array.from(effectsRegistry.values());
}
