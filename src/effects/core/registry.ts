import type { Filter } from 'pixi.js';
import type { ParamControl } from '~/components/properties/params';

export type EffectType = string;

export type EffectTarget = 'video' | 'audio';

export type AudioEffectCategory = 'basic' | 'artistic' | 'voice';

export interface AudioEffectContext {
  audioContext: BaseAudioContext;
  sourceNode?: AudioNode;
}

export interface AudioEffectNodeGraph {
  input: AudioNode;
  output: AudioNode;
}

export type AudioEffectNode = AudioNode | AudioEffectNodeGraph;

export interface BaseEffectManifest<T = Record<string, any>> {
  type: EffectType;
  name: string;
  nameKey?: string;
  description: string;
  descriptionKey?: string;
  icon: string;
  target?: EffectTarget;
  defaultValues: T;
  controls: ParamControl[];
  settingsControls?: ParamControl[];
  isCustom?: boolean;
  baseType?: string;
}

export interface VideoEffectManifest<T = Record<string, any>> extends BaseEffectManifest<T> {
  target?: 'video';
  createFilter: () => Filter;
  updateFilter: (filter: Filter, values: T) => void;
}

export interface AudioEffectManifest<T = Record<string, any>> extends BaseEffectManifest<T> {
  target: 'audio';
  category?: AudioEffectCategory;
  disableGlobalWet?: boolean; // If true, effectGraph won't apply wet/dry crossfade
  createNode?: (context: AudioEffectContext) => AudioEffectNode;
  updateNode?: (node: AudioEffectNode, values: T, context: AudioEffectContext) => void;
  destroyNode?: (node: AudioEffectNode, context: AudioEffectContext) => void;
}

export type EffectManifest<T = Record<string, any>> =
  | VideoEffectManifest<T>
  | AudioEffectManifest<T>;

export interface BaseClipEffect {
  id: string;
  type: EffectType;
  enabled: boolean;
  target?: EffectTarget;
}

export type ClipEffect<T = Record<string, any>> = BaseClipEffect & T;

// Registry
const effectsRegistry = new Map<EffectType, EffectManifest<any>>();

export function registerEffect<T>(manifest: EffectManifest<T>) {
  if ('createNode' in manifest || manifest.target === 'audio') {
    const audioManifest: AudioEffectManifest<T> = {
      ...manifest,
      target: 'audio',
    };

    effectsRegistry.set(manifest.type, audioManifest);

    return;
  }

  const videoManifest: VideoEffectManifest<T> = {
    ...manifest,
    target: 'video',
  };

  effectsRegistry.set(manifest.type, videoManifest);
}

export function getEffectManifest(type: EffectType): EffectManifest<any> | undefined {
  return effectsRegistry.get(type);
}

export function isVideoEffectManifest<T>(
  manifest: EffectManifest<T> | undefined,
): manifest is VideoEffectManifest<T> {
  if (!manifest) {
    return false;
  }

  return (manifest.target ?? 'video') === 'video';
}

export function isAudioEffectManifest<T>(
  manifest: EffectManifest<T> | undefined,
): manifest is AudioEffectManifest<T> {
  if (!manifest) {
    return false;
  }

  return manifest.target === 'audio';
}

export function getVideoEffectManifest(type: EffectType): VideoEffectManifest<any> | undefined {
  const manifest = effectsRegistry.get(type);
  return isVideoEffectManifest(manifest) ? manifest : undefined;
}

export function getAudioEffectManifest(type: EffectType): AudioEffectManifest<any> | undefined {
  const manifest = effectsRegistry.get(type);
  return isAudioEffectManifest(manifest) ? manifest : undefined;
}

export function isAudioEffectNodeGraph(node: AudioEffectNode): node is AudioEffectNodeGraph {
  return 'input' in node && 'output' in node;
}

export function getAllEffectManifests(target?: EffectTarget): EffectManifest<any>[] {
  const manifests = Array.from(effectsRegistry.values());
  if (!target) {
    return manifests;
  }

  return manifests.filter((manifest) => (manifest.target ?? 'video') === target);
}

export function getAllVideoEffectManifests(): VideoEffectManifest<any>[] {
  return getAllEffectManifests('video').filter(isVideoEffectManifest);
}

export function getAllAudioEffectManifests(): AudioEffectManifest<any>[] {
  return getAllEffectManifests('audio').filter(isAudioEffectManifest);
}
