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
  startTicks: number;
  durationTicks: number;
  sourceStartTicks: number;
  sourceRangeDurationTicks: number;
  sourceDurationTicks: number;
  speed?: number;
  audioGain?: number;
  audioBalance?: number;
  animations?: ClipAnimations;
  originalAudioGain?: unknown;
  originalAudioBalance?: unknown;
  audioFadeInTicks?: number;
  audioFadeOutTicks?: number;
  audioFadeInCurve?: 'linear' | 'logarithmic';
  audioFadeOutCurve?: 'linear' | 'logarithmic';
  audioDeclickDurationTicks?: number;
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
    startTicks: clip.timelineRange.startTicks,
    durationTicks: clip.timelineRange.durationTicks,
    sourceStartTicks: clip.sourceRange.startTicks,
    sourceRangeDurationTicks: clip.sourceRange.durationTicks,
    sourceDurationTicks: clip.sourceDurationTicks ?? clip.sourceRange.durationTicks,
    speed: clip.speed,
    audioGain: clip.audioGain,
    audioBalance: clip.audioBalance,
    animations: clip.animations,
    originalAudioGain: clip.originalAudioGain,
    originalAudioBalance: clip.originalAudioBalance,
    audioFadeInTicks: clip.audioFadeInTicks,
    audioFadeOutTicks: clip.audioFadeOutTicks,
    audioFadeInCurve: clip.audioFadeInCurve,
    audioFadeOutCurve: clip.audioFadeOutCurve,
    audioDeclickDurationTicks: clip.audioDeclickDurationTicks,
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
    startTicks: descriptor.startTicks,
    durationTicks: descriptor.durationTicks,
    sourceStartTicks: descriptor.sourceStartTicks,
    sourceRangeDurationTicks: descriptor.sourceRangeDurationTicks,
    sourceDurationTicks: descriptor.sourceDurationTicks,
    speed: descriptor.speed,
    audioGain: descriptor.audioGain,
    audioBalance: descriptor.audioBalance,
    animations: descriptor.animations,
    audioFadeInTicks: descriptor.audioFadeInTicks,
    audioFadeOutTicks: descriptor.audioFadeOutTicks,
    audioFadeInCurve: descriptor.audioFadeInCurve,
    audioFadeOutCurve: descriptor.audioFadeOutCurve,
    audioDeclickDurationTicks: descriptor.audioDeclickDurationTicks,
    defaultAudioFadeCurve: descriptor.defaultAudioFadeCurve,
    transitionIn: descriptor.transitionIn,
    transitionOut: descriptor.transitionOut,
    audioEffects: descriptor.audioEffects,
  };
}

function descriptorToEnvelopeClip(d: CanonicalAudioClipDescriptor): AudioEnvelopeClipLike {
  return {
    timelineRange: { durationTicks: d.durationTicks },
    audioFadeInTicks: d.audioFadeInTicks,
    audioFadeOutTicks: d.audioFadeOutTicks,
    audioFadeInCurve: d.audioFadeInCurve,
    audioFadeOutCurve: d.audioFadeOutCurve,
    audioDeclickDurationTicks: d.audioDeclickDurationTicks,
    transitionIn: d.transitionIn,
    transitionOut: d.transitionOut,
  };
}

/**
 * Duration (ticks) by which a clip overlaps its neighbour for an *adjacent*
 * transition (a true crossfade). Non-adjacent transitions (background/dip,
 * transparent) do not overlap, so they contribute no extension.
 */
function adjacentTransitionDurationTicks(
  transition: CanonicalAudioClipDescriptor['transitionIn'],
): number {
  if (!transition) return 0;
  const dur =
    typeof transition.durationTicks === 'number' && Number.isFinite(transition.durationTicks)
      ? transition.durationTicks
      : 0;
  if (dur <= 0) return 0;
  return transition.mode === 'adjacent' ? dur : 0;
}

export function toNativeSceneAudioLayer(params: ToNativeSceneAudioLayerParams): SceneAudioLayer {
  const descriptor = params.descriptor;
  const signedSpeed = clampFinite(descriptor.speed, 1) || 1;
  const absSpeed = Math.max(0.01, Math.min(100, Math.abs(signedSpeed)));

  const startTicks = Math.max(0, descriptor.startTicks);
  const durationTicks = Math.max(0, descriptor.durationTicks);
  const sourceStartTicks = Math.max(0, descriptor.sourceStartTicks);
  const sourceRangeDurationTicks = Math.max(0, descriptor.sourceRangeDurationTicks);
  const materialDurationTicks = Math.max(
    0,
    clampFinite(descriptor.sourceDurationTicks, sourceRangeDurationTicks),
  );

  // Effective fades fold in: manual fades, the auto de-click (removes the click at
  // every plain cut), an adjacent transition rendered as a crossfade, and curve
  // inheritance from a touching neighbour. The native mixer only carries plain
  // fade-in/out durations, so this is where the worker AudioMixer's edge handling
  // is reproduced for the native (monitor + export) path.
  const fadeClipDurationS = ticksToSeconds(
    Math.min(sourceRangeDurationTicks / absSpeed, durationTicks || sourceRangeDurationTicks / absSpeed),
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
  const inDurTicks = adjacentTransitionDurationTicks(descriptor.transitionIn);
  const outDurTicks = adjacentTransitionDurationTicks(descriptor.transitionOut);

  // Default (no crossfade): keep the clip's exact ranges and only override the
  // fades. The common case stays byte-for-byte identical to before plus de-click.
  let timelineStartTicks = startTicks;
  let timelineDurationTicks = durationTicks;
  let layerSourceStartTicks = sourceStartTicks;
  let layerSourceRangeTicks = sourceRangeDurationTicks;

  if (inDurTicks > 0 || outDurTicks > 0) {
    // Mirrors the worker AudioMixer handle extension (incl. material clamping)
    // so the native monitor + export agree with the web paths. Reversed clips
    // are muted before reaching the mixer (see `mix_layer_into` in mix.rs), so
    // this only needs to handle forward playback.
    let playDurationTicks = Math.min(
      sourceRangeDurationTicks / absSpeed,
      durationTicks || sourceRangeDurationTicks / absSpeed,
    );
    let effectiveStartTicks = startTicks;
    let effectiveOffsetTicks = sourceStartTicks;

    if (outDurTicks > 0) {
      playDurationTicks += outDurTicks;
    }

    if (inDurTicks > 0) {
      playDurationTicks += inDurTicks;
      effectiveStartTicks = Math.max(0, startTicks - inDurTicks);
      effectiveOffsetTicks = Math.max(0, effectiveOffsetTicks - inDurTicks * absSpeed);
    }

    const offsetTicks = Math.max(0, effectiveOffsetTicks);
    const sourceWindowBaseTicks = playDurationTicks * absSpeed;
    const maxPlayableTicks = Math.max(0, materialDurationTicks - offsetTicks);
    const finalSourceWindowTicks = Math.min(sourceWindowBaseTicks, maxPlayableTicks);

    timelineStartTicks = effectiveStartTicks;
    timelineDurationTicks = finalSourceWindowTicks / absSpeed;
    layerSourceStartTicks = offsetTicks;
    layerSourceRangeTicks = finalSourceWindowTicks;
  }

  return {
    id: descriptor.id,
    track_id: descriptor.trackId,
    path: descriptor.sourcePath,
    timeline_start_sec: ticksToSeconds(timelineStartTicks),
    timeline_end_sec: ticksToSeconds(timelineStartTicks + timelineDurationTicks),
    source_start_sec: ticksToSeconds(layerSourceStartTicks),
    source_range_duration_sec: ticksToSeconds(Math.max(0, layerSourceRangeTicks)),
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
