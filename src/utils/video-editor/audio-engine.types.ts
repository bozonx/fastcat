import type { AudioFadeCurve, AudioTransitionEnvelope } from '~/utils/audio/envelope';
import type { AudioClipEffect } from '~/timeline/types';

export interface ClipPlaybackWindow {
  currentTimeS: number;
  startAtS: number;
  currentClipLocalS: number;
  remainingInClipS: number;
  effectiveStartS: number;
  effectiveSourceStartS: number;
  clipDurationS: number;
  clipSpeed: number;
  fadeInS: number;
  fadeOutS: number;
  fadeInCurve: AudioFadeCurve;
  fadeOutCurve: AudioFadeCurve;
  audioGain: number;
  audioBalance: number;
  effectiveSpeed: number;
}

export interface AudioEngineClip {
  id: string;
  trackId?: string;
  sourcePath: string;
  fileHandle: FileSystemFileHandle;
  startUs: number;
  durationUs: number;
  sourceStartUs: number;
  sourceRangeDurationUs: number;
  sourceDurationUs: number;
  speed?: number;
  audioGain?: number;
  audioBalance?: number;
  audioFadeInUs?: number;
  audioFadeOutUs?: number;
  audioFadeInCurve?: AudioFadeCurve;
  audioFadeOutCurve?: AudioFadeCurve;
  audioDeclickDurationUs?: number;
  transitionIn?: AudioTransitionEnvelope | null;
  transitionOut?: AudioTransitionEnvelope | null;
  audioEffects?: AudioClipEffect[];
}

export interface AudioChunk {
  // Index of the chunk in the source file (source time / chunkSize, floored).
  // Cache lookups use this rather than startTimeS to avoid drift when the
  // decoder yields the first sample slightly before/after the theoretical
  // boundary.
  chunkIndex: number;
  // Source-file time of the first decoded sample in `buffer`. May lag the
  // theoretical chunk boundary (chunkIndex * chunkSize) by up to one keyframe
  // interval because mediabunny seeks to the nearest key packet.
  startTimeS: number;
  durationS: number;
  buffer: AudioBuffer;
}

export interface AudioNodeCollection {
  nodes: Set<AudioBufferSourceNode>;
  cleanups: Map<AudioBufferSourceNode, () => void>;
}
