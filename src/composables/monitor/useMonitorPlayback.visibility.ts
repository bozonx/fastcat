import type { AudioEngine } from '~/utils/video-editor/AudioEngine';

export function syncMonitorPlaybackVisibility(params: {
  isPlaying: boolean;
  clampToTimeline: (timeUs: number) => number;
  audioEngine: AudioEngine;
  onPauseHiddenPlayback: () => void;
  onRestoreVisiblePlayback: (timeUs: number) => void;
}) {
  if (document.hidden) {
    if (params.isPlaying) {
      params.onPauseHiddenPlayback();
    }
    return;
  }

  if (!params.isPlaying) {
    return;
  }

  const timeUs = params.clampToTimeline(params.audioEngine.getCurrentTimeUs());
  params.onRestoreVisiblePlayback(timeUs);
}
