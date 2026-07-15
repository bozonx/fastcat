import type { WorkerTimelineClip } from '~/types/worker-payload';
import type { AudioClipEffect, ClipAnimations, ClipEffect } from '~/timeline/types';
import type { AudioEffectSpec } from '~/types/generated/native-monitor/AudioEffectSpec';
import type { SceneAudioLayer } from '~/types/generated/native-monitor/SceneAudioLayer';
import type { AudioEngineClip } from '~/utils/video-editor/audio-engine.types';
import {
  resolveEffectiveFadeDurationsSeconds,
  type AudioEnvelopeClipLike,
} from '~/utils/audio/envelope';
import { clampFinite } from '~/utils/math';
import { ticksToSeconds } from '~/utils/time';

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
  animations?: ClipAnimations;
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
      const { id, type: effectType, enabled, target: _target, wet, plugin, ...rest } = effect;
      return {
        id,
        type: effectType,
        enabled: Boolean(enabled),
        wet: typeof wet === 'number' ? wet : 1,
        params: rest as Record<string, unknown>,
        plugin: (plugin as AudioEffectSpec['plugin']) ?? null,
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
    animations: clip.animations,
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
    animations: descriptor.animations,
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
 * Duration (ticks) by which a clip overlaps its neighbour for an *adjacent*
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
  const fadeClipDurationS = ticksToSeconds(
    Math.min(sourceRangeDurationUs / absSpeed, durationUs || sourceRangeDurationUs / absSpeed),
  );
  const { fadeInS, fadeOutS, fadeInCurve, fadeOutCurve } = resolveEffectiveFadeDurationsSeconds({
    clipDurationS: fadeClipDurationS,
    clip: descriptorToEnvelopeClip(descriptor),
    previousClip: params.previous ? descriptorToEnvelopeClip(params.previous) : null,
    nextClip: params.next ? descriptorToEnvelopeClip(params.next) : null,
    defaultAudioFadeCurve: descriptor.defaultAudioFadeCurve,
  });

  // Adjacent transitions render as a true audio crossfade by extending the clip
  // past the cut into its source handles, keyed off the clip's OWN transition —
  // exactly like the web live engine (`buildClipPlaybackWindow`) and the export
  // mixer (`AudioMixer`), and matching the native video compositor's
  // `transition_head_source_pts_at` / `transition_tail_source_pts_at`:
  //   - own `transitionOut` → play `D` seconds of the trailing handle past the
  //     clip's end and fade out over it (the OUTGOING side of the cut);
  //   - own `transitionIn` → start `D` seconds early on the leading handle and
  //     fade in over it (the INCOMING side of the cut).
  // The side that *owns* the transition object is the side that extends, so we
  // never inherit the neighbour's transition for the structural extension (the
  // fade *durations* still inherit via resolveEffectiveFadeDurationsSeconds).
  // Earlier this only extended the outgoing tail and left the incoming clip
  // un-shifted, which desynced the native monitor/export from the web engine on
  // a transition stored as `transitionIn`.
  const inDurUs = adjacentTransitionDurationUs(descriptor.transitionIn);
  const outDurUs = adjacentTransitionDurationUs(descriptor.transitionOut);

  // Default (no crossfade): keep the clip's exact ranges and only override the
  // fades. The common case stays byte-for-byte identical to before plus de-click.
  let timelineStartUs = startUs;
  let timelineDurationUs = durationUs;
  let layerSourceStartUs = sourceStartUs;
  let layerSourceRangeUs = sourceRangeDurationUs;

  if (inDurUs > 0 || outDurUs > 0) {
    // Mirrors the worker AudioMixer handle extension (incl. material clamping)
    // so the native monitor + export agree with the web paths. Reversed clips
    // are muted before reaching the mixer (see `mix_layer_into` in mix.rs), so
    // this only needs to handle forward playback.
    let playDurationUs = Math.min(
      sourceRangeDurationUs / absSpeed,
      durationUs || sourceRangeDurationUs / absSpeed,
    );
    let effectiveStartUs = startUs;
    let effectiveOffsetUs = sourceStartUs;

    if (outDurUs > 0) {
      playDurationUs += outDurUs;
    }

    if (inDurUs > 0) {
      playDurationUs += inDurUs;
      effectiveStartUs = Math.max(0, startUs - inDurUs);
      effectiveOffsetUs = Math.max(0, effectiveOffsetUs - inDurUs * absSpeed);
    }

    const offsetUs = Math.max(0, effectiveOffsetUs);
    const sourceWindowBaseUs = playDurationUs * absSpeed;
    const maxPlayableUs = Math.max(0, materialDurationUs - offsetUs);
    const finalSourceWindowUs = Math.min(sourceWindowBaseUs, maxPlayableUs);

    timelineStartUs = effectiveStartUs;
    timelineDurationUs = finalSourceWindowUs / absSpeed;
    layerSourceStartUs = offsetUs;
    layerSourceRangeUs = finalSourceWindowUs;
  }

  return {
    id: descriptor.id,
    track_id: descriptor.trackId,
    path: descriptor.sourcePath,
    timeline_start_sec: ticksToSeconds(timelineStartUs),
    timeline_end_sec: ticksToSeconds(timelineStartUs + timelineDurationUs),
    source_start_sec: ticksToSeconds(layerSourceStartUs),
    source_range_duration_sec: ticksToSeconds(Math.max(0, layerSourceRangeUs)),
    speed: sanitizeNativeAudioSpeed(descriptor.speed),
    // Gain stays split: the layer carries the clip-only gain and the native bus
    // re-applies the track gain (a scalar — multiplying layer×bus reproduces the
    // web merge exactly). Balance, however, can NOT be split: cascading two
    // equal-power pans (layer then bus) ≠ the web's single StereoPanner over the
    // *summed* balance. So we carry the already-merged (track+clip) balance here
    // and neutralize the bus pan (see native-monitor-scene.ts), giving the same
    // additive single-pan as the web live engine and export mixer.
    audio_gain: Math.max(0, clampFinite(descriptor.originalAudioGain ?? descriptor.audioGain, 1)),
    audio_balance: Math.max(-1, Math.min(1, clampFinite(descriptor.audioBalance, 0))),
    animations: descriptor.animations,
    audio_fade_in_sec: Math.max(0, fadeInS),
    audio_fade_out_sec: Math.max(0, fadeOutS),
    audio_fade_in_curve: fadeInCurve,
    audio_fade_out_curve: fadeOutCurve,
    audio_effects: buildNativeAudioEffectSpecs(descriptor.audioEffects),
  };
}
