import type { WorkerTimelineClip } from '~/composables/monitor/types';
import type { AudioClipEffect, ClipEffect } from '~/timeline/types';
import type { AudioEffectSpec } from '~/types/generated/native-monitor/AudioEffectSpec';
import type { SceneAudioLayer } from '~/types/generated/native-monitor/SceneAudioLayer';
import type { AudioEngineClip } from '~/utils/video-editor/audio-engine.types';
import {
  resolveEffectiveFadeDurationsSeconds,
  type AudioEnvelopeClipLike,
} from '~/utils/audio/envelope';
import { clampFinite } from '~/utils/math';
import { US_PER_SEC } from '~/utils/time';

interface AudioWorkerClip extends WorkerTimelineClip {
  defaultAudioFadeCurve?: 'linear' | 'logarithmic';
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
  /**
   * Same-track neighbours (by timeline order). Required for the native mixer to
   * reproduce the worker AudioMixer's edge handling: de-click fades, adjacent
   * transition crossfades and curve inheritance from a touching neighbour.
   */
  previous?: CanonicalAudioClipDescriptor | null;
  next?: CanonicalAudioClipDescriptor | null;
}

export function sanitizeNativeAudioSpeed(value: unknown): number {
  const raw = clampFinite(value, 1) || 1;
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

function descriptorToEnvelopeClip(d: CanonicalAudioClipDescriptor): AudioEnvelopeClipLike {
  return {
    timelineRange: { durationUs: d.durationUs },
    audioFadeInUs: d.audioFadeInUs,
    audioFadeOutUs: d.audioFadeOutUs,
    audioFadeInCurve: d.audioFadeInCurve,
    audioFadeOutCurve: d.audioFadeOutCurve,
    audioDeclickDurationUs: d.audioDeclickDurationUs,
    transitionIn: d.transitionIn,
    transitionOut: d.transitionOut,
  };
}

/**
 * Duration (µs) by which a clip overlaps its neighbour for an *adjacent*
 * transition (a true crossfade). Non-adjacent transitions (background/dip,
 * transparent) do not overlap, so they contribute no extension.
 */
function adjacentTransitionDurationUs(
  transition: CanonicalAudioClipDescriptor['transitionIn'],
): number {
  if (!transition) return 0;
  const dur =
    typeof transition.durationUs === 'number' && Number.isFinite(transition.durationUs)
      ? transition.durationUs
      : 0;
  if (dur <= 0) return 0;
  return transition.mode === 'adjacent' ? dur : 0;
}

export function toNativeSceneAudioLayer(params: ToNativeSceneAudioLayerParams): SceneAudioLayer {
  const descriptor = params.descriptor;
  const signedSpeed = clampFinite(descriptor.speed, 1) || 1;
  const reversed = signedSpeed < 0;
  const absSpeed = Math.max(0.01, Math.min(100, Math.abs(signedSpeed)));

  const startUs = Math.max(0, descriptor.startUs);
  const durationUs = Math.max(0, descriptor.durationUs);
  const sourceStartUs = Math.max(0, descriptor.sourceStartUs);
  const sourceRangeDurationUs = Math.max(0, descriptor.sourceRangeDurationUs);
  const materialDurationUs = Math.max(
    0,
    clampFinite(descriptor.sourceDurationUs, sourceRangeDurationUs),
  );

  // Effective fades fold in: manual fades, the auto de-click (removes the click at
  // every plain cut), an adjacent transition rendered as a crossfade, and curve
  // inheritance from a touching neighbour. The native mixer only carries plain
  // fade-in/out durations, so this is where the worker AudioMixer's edge handling
  // is reproduced for the native (monitor + export) path.
  const fadeClipDurationS =
    Math.min(sourceRangeDurationUs / absSpeed, durationUs || sourceRangeDurationUs / absSpeed) /
    US_PER_SEC;
  const { fadeInS, fadeOutS, fadeInCurve, fadeOutCurve } = resolveEffectiveFadeDurationsSeconds({
    clipDurationS: fadeClipDurationS,
    clip: descriptorToEnvelopeClip(descriptor),
    previousClip: params.previous ? descriptorToEnvelopeClip(params.previous) : null,
    nextClip: params.next ? descriptorToEnvelopeClip(params.next) : null,
    defaultAudioFadeCurve: descriptor.defaultAudioFadeCurve,
  });

  // The video transition for the cut between two adjacent clips A→B renders in
  // the *incoming* clip's window `[cut, cut+D)` (after the cut). Keep audio in
  // lockstep with it:
  //   - the OUTGOING clip plays D seconds of its tail/handle past the cut and
  //     fades out over `[cut, cut+D)` (forward extension below);
  //   - the INCOMING clip fades in over its own first D seconds `[cut, cut+D)`
  //     with NO backward extension — `fadeInS` already covers the head, and the
  //     extended head is exactly the source frames the video crossfade samples.
  // Resolve the effective outgoing transition the same way the fade durations
  // are (own `transitionOut`, else the next clip's inherited `transitionIn`), so
  // a transition stored on either side still extends the outgoing tail.
  const outgoingTransition = descriptor.transitionOut ?? params.next?.transitionIn ?? undefined;
  const outDurUs = adjacentTransitionDurationUs(outgoingTransition);

  // Default (no crossfade): keep the clip's exact ranges and only override the
  // fades. The common case stays byte-for-byte identical to before plus de-click.
  const timelineStartUs = startUs;
  let timelineDurationUs = durationUs;
  let layerSourceStartUs = sourceStartUs;
  let layerSourceRangeUs = sourceRangeDurationUs;

  if (outDurUs > 0) {
    // Extend the outgoing clip's tail past the cut so it overlaps the next clip
    // and the two clips' fades cross over `[cut, cut+D)`, instead of dipping to
    // silence at the butt seam. Mirrors the worker AudioMixer extension (incl.
    // reverse and material clamping).
    let playDurationUs = Math.min(
      sourceRangeDurationUs / absSpeed,
      durationUs || sourceRangeDurationUs / absSpeed,
    );
    let effectiveOffsetUs = sourceStartUs;
    let extraSourceTailUs = 0;

    playDurationUs += outDurUs;
    if (reversed) {
      effectiveOffsetUs = Math.max(0, effectiveOffsetUs - outDurUs * absSpeed);
    } else {
      extraSourceTailUs += outDurUs * absSpeed;
    }

    const offsetUs = Math.max(0, effectiveOffsetUs);
    const sourceWindowBaseUs = playDurationUs * absSpeed + extraSourceTailUs;
    const maxPlayableUs = Math.max(0, materialDurationUs - offsetUs);
    const finalSourceWindowUs = Math.min(sourceWindowBaseUs, maxPlayableUs);

    timelineDurationUs = finalSourceWindowUs / absSpeed;
    layerSourceStartUs = offsetUs;
    layerSourceRangeUs = finalSourceWindowUs;
  }

  return {
    id: descriptor.id,
    track_id: descriptor.trackId,
    path: descriptor.sourcePath,
    timeline_start_sec: timelineStartUs / US_PER_SEC,
    timeline_end_sec: (timelineStartUs + timelineDurationUs) / US_PER_SEC,
    source_start_sec: layerSourceStartUs / US_PER_SEC,
    source_range_duration_sec: Math.max(0, layerSourceRangeUs) / US_PER_SEC,
    speed: sanitizeNativeAudioSpeed(descriptor.speed),
    audio_gain: Math.max(0, clampFinite(descriptor.originalAudioGain ?? descriptor.audioGain, 1)),
    audio_balance: Math.max(
      -1,
      Math.min(1, clampFinite(descriptor.originalAudioBalance ?? descriptor.audioBalance, 0)),
    ),
    audio_fade_in_sec: Math.max(0, fadeInS),
    audio_fade_out_sec: Math.max(0, fadeOutS),
    audio_fade_in_curve: fadeInCurve,
    audio_fade_out_curve: fadeOutCurve,
    audio_effects: buildNativeAudioEffectSpecs(descriptor.audioEffects),
  };
}
