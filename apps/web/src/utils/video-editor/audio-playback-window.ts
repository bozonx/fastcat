import { TICKS_PER_SECOND } from '~/utils/time';
import {
  normalizeBalance,
  normalizeGain,
  resolveEffectiveFadeDurationsSeconds,
} from '~/utils/audio/envelope';
import { evalTrackAt } from '~/timeline/animation/evaluate';

import type { AudioEngineClip, ClipPlaybackWindow } from '~/utils/video-editor/audio-engine.types';

export interface AdjacentAudioClips {
  previousClip: AudioEngineClip | null;
  nextClip: AudioEngineClip | null;
}

export interface BuildClipPlaybackWindowParams {
  clip: AudioEngineClip;
  currentTimeS: number;
  speed: number;
  startAtS: number;
  adjacentClips: AdjacentAudioClips;
}

export function isReversedClip(clip: AudioEngineClip): boolean {
  return typeof clip.speed === 'number' && Number.isFinite(clip.speed) && clip.speed < 0;
}

export function getSourceTimeForClipLocal(window: ClipPlaybackWindow, clipLocalS: number): number {
  return window.effectiveSourceStartS + clipLocalS * window.clipSpeed;
}

/** True when the window carries an `audio.volume` keyframe track. */
export function hasVolumeAnimation(window: ClipPlaybackWindow): boolean {
  return !!window.animations?.['audio.volume']?.keyframes.length;
}

/** True when the window carries an `audio.pan` keyframe track. */
export function hasPanAnimation(window: ClipPlaybackWindow): boolean {
  return !!window.animations?.['audio.pan']?.keyframes.length;
}

/**
 * Base clip gain at a clip-local time, honouring an `audio.volume` keyframe
 * track (sampled at the source-relative time, same as the export mixer +
 * native engine). Falls back to the clip's static gain when unanimated. This is
 * the pre-fade base — {@link getGainAtClipTime} applies fades on top.
 */
export function resolveAnimatedBaseGain(window: ClipPlaybackWindow, clipLocalS: number): number {
  const track = window.animations?.['audio.volume'];
  if (!track?.keyframes.length) return window.audioGain;
  const sourceTicks = Math.round(getSourceTimeForClipLocal(window, clipLocalS) * TICKS_PER_SECOND);
  const value = evalTrackAt(track, sourceTicks);
  return value === undefined ? window.audioGain : Math.max(0, Math.min(10, value));
}

/**
 * Balance (pan) at a clip-local time, honouring an `audio.pan` keyframe track.
 * Falls back to the clip's static balance when unanimated.
 */
export function resolveAnimatedPan(window: ClipPlaybackWindow, clipLocalS: number): number {
  const track = window.animations?.['audio.pan'];
  if (!track?.keyframes.length) return window.audioBalance;
  const sourceTicks = Math.round(getSourceTimeForClipLocal(window, clipLocalS) * TICKS_PER_SECOND);
  const value = evalTrackAt(track, sourceTicks);
  return value === undefined ? window.audioBalance : Math.max(-1, Math.min(1, value));
}

export function buildClipPlaybackWindow(
  params: BuildClipPlaybackWindowParams,
): ClipPlaybackWindow | null {
  const { clip, currentTimeS, speed, startAtS, adjacentClips } = params;
  const clipDurationS = clip.durationTicks / TICKS_PER_SECOND;
  const speedRaw = clip.speed;

  const clipSpeed =
    typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw !== 0
      ? Math.min(10, Math.abs(speedRaw))
      : 1;
  const effectiveSpeed = clipSpeed * speed;

  if (!Number.isFinite(effectiveSpeed) || effectiveSpeed <= 0) {
    return null;
  }

  const { previousClip, nextClip } = adjacentClips;
  const { fadeInS, fadeOutS, fadeInCurve, fadeOutCurve } = resolveEffectiveFadeDurationsSeconds({
    clipDurationS,
    clip,
    previousClip,
    nextClip,
    defaultAudioFadeCurve: clip.defaultAudioFadeCurve,
  });

  const audioGain = normalizeGain(clip.audioGain, 1);
  const audioBalance = normalizeBalance(clip.audioBalance, 0);

  let effectivePlayDurationS = clipDurationS;
  let effectiveStartTicks = clip.startTicks;
  let effectiveSourceStartTicks = clip.sourceStartTicks;

  if (
    clip.transitionOut?.durationTicks &&
    Number(clip.transitionOut.durationTicks) > 0 &&
    clip.transitionOut.mode === 'adjacent'
  ) {
    effectivePlayDurationS += Number(clip.transitionOut.durationTicks) / TICKS_PER_SECOND;
  }

  if (
    clip.transitionIn?.durationTicks &&
    Number(clip.transitionIn.durationTicks) > 0 &&
    clip.transitionIn.mode === 'adjacent'
  ) {
    effectivePlayDurationS += Number(clip.transitionIn.durationTicks) / TICKS_PER_SECOND;
    effectiveStartTicks = Math.max(0, clip.startTicks - Number(clip.transitionIn.durationTicks));
    effectiveSourceStartTicks = Math.max(
      0,
      clip.sourceStartTicks - Number(clip.transitionIn.durationTicks) * clipSpeed,
    );
  }

  const effectiveStartS = effectiveStartTicks / TICKS_PER_SECOND;
  const effectiveSourceStartS = effectiveSourceStartTicks / TICKS_PER_SECOND;
  const effectiveSourceEndS = effectiveSourceStartS + effectivePlayDurationS * clipSpeed;
  const currentClipLocalS = Math.max(0, currentTimeS - effectiveStartS);
  const remainingInClipS = Math.max(0, effectivePlayDurationS - currentClipLocalS);

  if (remainingInClipS <= 0) {
    return null;
  }

  return {
    currentTimeS,
    startAtS,
    currentClipLocalS,
    remainingInClipS,
    effectiveStartS,
    effectiveSourceStartS,
    effectiveSourceEndS,
    effectivePlayDurationS,
    clipDurationS,
    clipSpeed,
    fadeInS,
    fadeOutS,
    fadeInCurve,
    fadeOutCurve,
    audioGain,
    audioBalance,
    effectiveSpeed,
    globalSpeed: speed,
    animations: clip.animations,
  };
}
