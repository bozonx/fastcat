import type { AudioFadeCurve, AudioTransitionEnvelope } from '~/utils/audio/envelope';
import type { AudioClipEffect, ClipAnimations } from '~/timeline/types';

export interface ClipPlaybackWindow {
  currentTimeS: number;
  startAtS: number;
  currentClipLocalS: number;
  remainingInClipS: number;
  effectiveStartS: number;
  effectiveSourceStartS: number;
  effectiveSourceEndS: number;
  // The actual timeline duration being played. For adjacent transitions this
  // includes source handles before/after the nominal clip range.
  effectivePlayDurationS: number;
  clipDurationS: number;
  clipSpeed: number;
  fadeInS: number;
  fadeOutS: number;
  fadeInCurve: AudioFadeCurve;
  fadeOutCurve: AudioFadeCurve;
  audioGain: number;
  audioBalance: number;
  effectiveSpeed: number;
  globalSpeed: number;
  // Keyframe tracks carried through so the gain/pan envelopes can honour
  // `audio.volume` / `audio.pan` animation in realtime playback (matching the
  // export mixer + native engine). Undefined when the clip has no keyframes.
  animations?: ClipAnimations;
}

export interface AudioEngineClip {
  id: string;
  trackId?: string;
  sourcePath: string;
  fileHandle: FileSystemFileHandle;
  startTicks: number;
  durationTicks: number;
  sourceStartTicks: number;
  sourceRangeDurationTicks: number;
  sourceDurationTicks: number;
  speed?: number;
  audioGain?: number;
  audioBalance?: number;
  animations?: ClipAnimations;
  audioFadeInTicks?: number;
  audioFadeOutTicks?: number;
  audioFadeInCurve?: AudioFadeCurve;
  audioFadeOutCurve?: AudioFadeCurve;
  audioDeclickDurationTicks?: number;
  defaultAudioFadeCurve?: AudioFadeCurve;
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
  // Total playable length of `buffer` in seconds. Includes the trailing
  // crossfade overlap (see `nominalDurationS`), so it can exceed the nominal
  // chunk size by up to one seam-crossfade.
  durationS: number;
  // The chunk's cursor-advancing extent in seconds (the configured chunk size).
  // The playback scheduler advances the playhead by at most this much per chunk
  // and treats `buffer` content past it as the trailing crossfade overlap that
  // the next chunk fades in over. May be undefined for legacy cached chunks
  // decoded before overlap support, in which case there is no overlap tail.
  nominalDurationS?: number;
  buffer: AudioBuffer;
}

export interface AudioNodeCollection {
  nodes: Set<AudioBufferSourceNode>;
  cleanups: Map<AudioBufferSourceNode, () => void | Promise<void>>;
  gains: Map<AudioBufferSourceNode, GainNode>;
}
