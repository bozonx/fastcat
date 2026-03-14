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

export interface AudioNodeCollection {
  nodes: Set<AudioBufferSourceNode>;
  cleanups: Map<AudioBufferSourceNode, () => void>;
}
