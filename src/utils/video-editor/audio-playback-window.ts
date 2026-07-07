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
  const sourceUs = Math.round(getSourceTimeForClipLocal(window, clipLocalS) * 1_000_000);
  const value = evalTrackAt(track, sourceUs);
  return value === undefined ? window.audioGain : Math.max(0, Math.min(10, value));
}

/**
 * Balance (pan) at a clip-local time, honouring an `audio.pan` keyframe track.
 * Falls back to the clip's static balance when unanimated.
 */
export function resolveAnimatedPan(window: ClipPlaybackWindow, clipLocalS: number): number {
  const track = window.animations?.['audio.pan'];
  if (!track?.keyframes.length) return window.audioBalance;
  const sourceUs = Math.round(getSourceTimeForClipLocal(window, clipLocalS) * 1_000_000);
  const value = evalTrackAt(track, sourceUs);
  return value === undefined ? window.audioBalance : Math.max(-1, Math.min(1, value));
}

export function buildClipPlaybackWindow(
  params: BuildClipPlaybackWindowParams,
): ClipPlaybackWindow | null {
  const { clip, currentTimeS, speed, startAtS, adjacentClips } = params;
  const clipDurationS = clip.durationUs / 1_000_000;
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
  let effectiveStartUs = clip.startUs;
  let effectiveSourceStartUs = clip.sourceStartUs;

  if (
    clip.transitionOut?.durationUs &&
    Number(clip.transitionOut.durationUs) > 0 &&
    clip.transitionOut.mode === 'adjacent'
  ) {
    effectivePlayDurationS += Number(clip.transitionOut.durationUs) / 1_000_000;
  }

  if (
    clip.transitionIn?.durationUs &&
    Number(clip.transitionIn.durationUs) > 0 &&
    clip.transitionIn.mode === 'adjacent'
  ) {
    effectivePlayDurationS += Number(clip.transitionIn.durationUs) / 1_000_000;
    effectiveStartUs = Math.max(0, clip.startUs - Number(clip.transitionIn.durationUs));
    effectiveSourceStartUs = Math.max(
      0,
      clip.sourceStartUs - Number(clip.transitionIn.durationUs) * clipSpeed,
    );
  }

  const effectiveStartS = effectiveStartUs / 1_000_000;
  const effectiveSourceStartS = effectiveSourceStartUs / 1_000_000;
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
