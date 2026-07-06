import type { ParamControl } from '~/types/params';
import type { VideoEffectSpec } from '~/types/generated/native-monitor/VideoEffectSpec';
import { getVideoEffectManifestByType, videoEffectManifests } from '../video-manifests';

export type { VideoEffectSpec };

export type EffectType = string;

export type EffectTarget = 'video' | 'audio';
// Video effects always run through the shared WGSL compute shader
// (`shared/effects/effect.wgsl`) on both backends. The Pixi-filter path is gone.
export type VideoEffectRenderer = 'wgsl-compute';

export type AudioEffectCategory = 'basic' | 'artistic' | 'voice';

export interface AudioEffectContext {
  audioContext: BaseAudioContext;
}

export interface AudioEffectNodeGraph {
  input: AudioNode;
  output: AudioNode;
}

export type AudioEffectNode = AudioNode | AudioEffectNodeGraph;

export interface BaseEffectManifest<T = Record<string, unknown>> {
  type: EffectType;
  name: string;
  nameKey?: string;
  description: string;
  descriptionKey?: string;
  icon: string;
  target?: EffectTarget;
  category?: AudioEffectCategory;
  defaultValues: T;
  controls: ParamControl[];
  paramRanges?: Record<string, EffectParamRange>;
  settingsControls?: ParamControl[];
  isCustom?: boolean;
  baseType?: string;
  hidden?: boolean;
  experimental?: boolean;
}

export interface EffectParamRange {
  uiMin: number;
  uiMax: number;
  animationMin: number;
  animationMax: number;
  renderMin: number;
  renderMax: number;
}

export interface VideoEffectManifest<T = Record<string, unknown>> extends BaseEffectManifest<T> {
  target?: 'video';
  renderer?: VideoEffectRenderer;
  /** Maps UI values to the cross-backend effect spec consumed by both runners. */
  toEffectSpecs?: (values: T) => VideoEffectSpec[];
}

export interface AudioEffectManifest<T = Record<string, unknown>> extends BaseEffectManifest<T> {
  target: 'audio';
  category?: AudioEffectCategory;
  disableGlobalWet?: boolean; // If true, effectGraph won't apply wet/dry crossfade
  createNode?: (context: AudioEffectContext) => AudioEffectNode | Promise<AudioEffectNode>;
  updateNode?: (
    node: AudioEffectNode,
    values: T,
    context: AudioEffectContext,
  ) => void | Promise<void>;
  destroyNode?: (node: AudioEffectNode, context: AudioEffectContext) => void | Promise<void>;
}

export type EffectManifest<T = Record<string, unknown>> =
  | VideoEffectManifest<T>
  | AudioEffectManifest<T>;

export interface BaseClipEffect {
  id: string;
  type: EffectType;
  enabled: boolean;
  target?: EffectTarget;
}

export type ClipEffect<T = Record<string, unknown>> = BaseClipEffect & T;

// Registry
const effectsRegistry = new Map<EffectType, EffectManifest<Record<string, unknown>>>();

export function registerEffect<T>(manifest: EffectManifest<T>) {
  if ('createNode' in manifest || manifest.target === 'audio') {
    const audioManifest: AudioEffectManifest<T> = {
      ...manifest,
      target: 'audio',
    };

    effectsRegistry.set(manifest.type, audioManifest as EffectManifest<Record<string, unknown>>);

    return;
  }

  const videoManifest: VideoEffectManifest<T> = {
    ...manifest,
    target: 'video',
  };

  effectsRegistry.set(manifest.type, videoManifest as EffectManifest<Record<string, unknown>>);
}

export function unregisterEffect(type: EffectType) {
  effectsRegistry.delete(type);
}

export function getEffectManifest(
  type: EffectType,
): EffectManifest<Record<string, unknown>> | undefined {
  // Single catalog for both runtimes: video effects come from the unified
  // `videoEffectManifests`, audio (and any registered custom effects) from the
  // runtime registry.
  const videoManifest = getVideoEffectManifestByType(type);
  if (videoManifest) {
    return videoManifest as EffectManifest<Record<string, unknown>>;
  }

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

export function getVideoEffectManifest(
  type: EffectType,
): VideoEffectManifest<Record<string, unknown>> | undefined {
  const manifest = getEffectManifest(type);
  return isVideoEffectManifest(manifest) ? manifest : undefined;
}

export function getAudioEffectManifest(
  type: EffectType,
): AudioEffectManifest<Record<string, unknown>> | undefined {
  const manifest = effectsRegistry.get(type);
  return isAudioEffectManifest(manifest) ? manifest : undefined;
}

export function isAudioEffectNodeGraph(node: AudioEffectNode): node is AudioEffectNodeGraph {
  return 'input' in node && 'output' in node;
}

export function getAllEffectManifests(
  target?: EffectTarget,
): EffectManifest<Record<string, unknown>>[] {
  // Custom (plugin) video effects are registered into the runtime registry; the
  // built-in video catalog is the shared `videoEffectManifests`.
  const customVideo = Array.from(effectsRegistry.values())
    .filter(isVideoEffectManifest)
    .filter((manifest) => manifest.isCustom);
  const videoManifests = [...videoEffectManifests, ...customVideo] as EffectManifest<
    Record<string, unknown>
  >[];

  const filteredVideo = videoManifests.filter((manifest) => !manifest.hidden);

  if (target === 'video') {
    return filteredVideo;
  }

  const audioManifests = Array.from(effectsRegistry.values()).filter(isAudioEffectManifest);
  const filteredAudio = audioManifests.filter((manifest) => !manifest.hidden);
  if (target === 'audio') {
    return filteredAudio as EffectManifest<Record<string, unknown>>[];
  }

  return [...filteredVideo, ...filteredAudio];
}

export function getAllVideoEffectManifests(): VideoEffectManifest<Record<string, unknown>>[] {
  return getAllEffectManifests('video').filter(isVideoEffectManifest);
}

export function getAllAudioEffectManifests(): AudioEffectManifest<Record<string, unknown>>[] {
  return getAllEffectManifests('audio').filter(isAudioEffectManifest);
}
