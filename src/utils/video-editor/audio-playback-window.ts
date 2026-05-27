import {
  normalizeBalance,
  normalizeGain,
  resolveEffectiveFadeDurationsSeconds,
} from '~/utils/audio/envelope';

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
  if (window.reversed) {
    return window.effectiveSourceEndS - clipLocalS * window.clipSpeed;
  }
  return window.effectiveSourceStartS + clipLocalS * window.clipSpeed;
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
  const reversed = isReversedClip(clip);
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
    reversed,
    fadeInS,
    fadeOutS,
    fadeInCurve,
    fadeOutCurve,
    audioGain,
    audioBalance,
    effectiveSpeed,
    globalSpeed: speed,
  };
}
