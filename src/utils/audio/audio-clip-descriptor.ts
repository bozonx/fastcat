import type { WorkerTimelineClip } from '~/composables/monitor/types';
import type { AudioClipEffect, ClipEffect } from '~/timeline/types';
import type { AudioEffectSpec } from '~/types/generated/native-monitor/AudioEffectSpec';
import type { SceneAudioLayer } from '~/types/generated/native-monitor/SceneAudioLayer';
import type { AudioEngineClip } from '~/utils/video-editor/audio-engine.types';

interface AudioWorkerClip extends WorkerTimelineClip {
  defaultAudioFadeCurve?: 'linear' | 'logarithmic';
  originalAudioGain?: unknown;
  originalAudioBalance?: unknown;
}

export interface CanonicalAudioClipDescriptor {
  id: string;
  trackId?: string;
  sourcePath: string;
  startUs: number;
  durationUs: number;
  sourceStartUs: number;
  sourceRangeDurationUs: number;
  sourceDurationUs: number;
  speed?: number;
  audioGain?: number;
  audioBalance?: number;
  originalAudioGain?: unknown;
  originalAudioBalance?: unknown;
  audioFadeInUs?: number;
  audioFadeOutUs?: number;
  audioFadeInCurve?: 'linear' | 'logarithmic';
  audioFadeOutCurve?: 'linear' | 'logarithmic';
  audioDeclickDurationUs?: number;
  defaultAudioFadeCurve?: 'linear' | 'logarithmic';
  transitionIn?: WorkerTimelineClip['transitionIn'];
  transitionOut?: WorkerTimelineClip['transitionOut'];
  audioEffects: AudioClipEffect[];
}

export interface BuildCanonicalAudioClipDescriptorParams {
  clip: WorkerTimelineClip;
  sourcePath: string;
}

export interface ToAudioEngineClipParams {
  descriptor: CanonicalAudioClipDescriptor;
  fileHandle: FileSystemFileHandle;
}

export interface ToNativeSceneAudioLayerParams {
  descriptor: CanonicalAudioClipDescriptor;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function sanitizeNativeAudioSpeed(value: unknown): number {
  const raw = finite(value, 1) || 1;
  const clamped = Math.max(0.01, Math.min(100, Math.abs(raw)));
  return raw < 0 ? -clamped : clamped;
}

function isAudioClipEffect(effect: ClipEffect<Record<string, unknown>>): effect is AudioClipEffect {
  return effect?.target === 'audio';
}

export function buildNativeAudioEffectSpecs(effects?: ClipEffect[]): AudioEffectSpec[] {
  if (!Array.isArray(effects) || effects.length === 0) {
    return [];
  }
  return effects
    .filter((effect): effect is ClipEffect & Record<string, unknown> =>
      Boolean(effect?.enabled && effect.target === 'audio'),
    )
    .map((effect) => {
      const { id, type: effectType, enabled, target: _target, wet, ...rest } = effect;
      return {
        id,
        type: effectType,
        enabled: Boolean(enabled),
        wet: typeof wet === 'number' ? wet : 1,
        params: rest as Record<string, unknown>,
      };
    });
}

export function buildCanonicalAudioClipDescriptor(
  params: BuildCanonicalAudioClipDescriptorParams,
): CanonicalAudioClipDescriptor {
  const clip = params.clip as AudioWorkerClip;
  return {
    id: clip.id,
    trackId: clip.trackId,
    sourcePath: params.sourcePath,
    startUs: clip.timelineRange.startUs,
    durationUs: clip.timelineRange.durationUs,
    sourceStartUs: clip.sourceRange.startUs,
    sourceRangeDurationUs: clip.sourceRange.durationUs,
    sourceDurationUs: clip.sourceDurationUs ?? clip.sourceRange.durationUs,
    speed: clip.speed,
    audioGain: clip.audioGain,
    audioBalance: clip.audioBalance,
    originalAudioGain: clip.originalAudioGain,
    originalAudioBalance: clip.originalAudioBalance,
    audioFadeInUs: clip.audioFadeInUs,
    audioFadeOutUs: clip.audioFadeOutUs,
    audioFadeInCurve: clip.audioFadeInCurve,
    audioFadeOutCurve: clip.audioFadeOutCurve,
    audioDeclickDurationUs: clip.audioDeclickDurationUs,
    defaultAudioFadeCurve: clip.defaultAudioFadeCurve,
    transitionIn: clip.transitionIn,
    transitionOut: clip.transitionOut,
    audioEffects: (clip.effects ?? []).filter(isAudioClipEffect),
  };
}

export function toAudioEngineClip(params: ToAudioEngineClipParams): AudioEngineClip {
  const descriptor = params.descriptor;
  return {
    id: descriptor.id,
    trackId: descriptor.trackId,
    sourcePath: descriptor.sourcePath,
    fileHandle: params.fileHandle,
    startUs: descriptor.startUs,
    durationUs: descriptor.durationUs,
    sourceStartUs: descriptor.sourceStartUs,
    sourceRangeDurationUs: descriptor.sourceRangeDurationUs,
    sourceDurationUs: descriptor.sourceDurationUs,
    speed: descriptor.speed,
    audioGain: descriptor.audioGain,
    audioBalance: descriptor.audioBalance,
    audioFadeInUs: descriptor.audioFadeInUs,
    audioFadeOutUs: descriptor.audioFadeOutUs,
    audioFadeInCurve: descriptor.audioFadeInCurve,
    audioFadeOutCurve: descriptor.audioFadeOutCurve,
    audioDeclickDurationUs: descriptor.audioDeclickDurationUs,
    defaultAudioFadeCurve: descriptor.defaultAudioFadeCurve,
    transitionIn: descriptor.transitionIn,
    transitionOut: descriptor.transitionOut,
    audioEffects: descriptor.audioEffects,
  };
}

export function toNativeSceneAudioLayer(params: ToNativeSceneAudioLayerParams): SceneAudioLayer {
  const descriptor = params.descriptor;
  return {
    id: descriptor.id,
    track_id: descriptor.trackId,
    path: descriptor.sourcePath,
    timeline_start_sec: descriptor.startUs / 1_000_000,
    timeline_end_sec: (descriptor.startUs + descriptor.durationUs) / 1_000_000,
    source_start_sec: descriptor.sourceStartUs / 1_000_000,
    source_range_duration_sec: Math.max(0, descriptor.sourceRangeDurationUs) / 1_000_000,
    speed: sanitizeNativeAudioSpeed(descriptor.speed),
    audio_gain: Math.max(0, finite(descriptor.originalAudioGain ?? descriptor.audioGain, 1)),
    audio_balance: Math.max(
      -1,
      Math.min(1, finite(descriptor.originalAudioBalance ?? descriptor.audioBalance, 0)),
    ),
    audio_fade_in_sec: Math.max(0, finite(descriptor.audioFadeInUs, 0) / 1_000_000),
    audio_fade_out_sec: Math.max(0, finite(descriptor.audioFadeOutUs, 0) / 1_000_000),
    audio_fade_in_curve: descriptor.audioFadeInCurve ?? 'linear',
    audio_fade_out_curve: descriptor.audioFadeOutCurve ?? 'linear',
    audio_effects: buildNativeAudioEffectSpecs(descriptor.audioEffects),
  };
}
