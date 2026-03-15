import type { AudioEngine } from '~/utils/video-editor/AudioEngine';
import type { useTimelineStore } from '~/stores/timeline.store';

function approxEqual(a: number, b: number) {
  return Math.abs(a - b) <= 0.2;
}

export function syncMonitorAudioLevels(params: {
  timelineStore: ReturnType<typeof useTimelineStore>;
  audioEngine: AudioEngine;
}) {
  const prevLevels = params.timelineStore.audioLevels;
  const nextLevels = { ...prevLevels };
  const masterLevels = params.audioEngine.getLevels();
  nextLevels.master = masterLevels;

  const tracks = params.timelineStore.timelineDoc?.tracks ?? [];
  for (const track of tracks) {
    if (track.kind === 'audio' || track.kind === 'video') {
      nextLevels[track.id] = params.audioEngine.getLevels(track.id);
    }
  }

  let changed = false;
  for (const [id, levels] of Object.entries(nextLevels)) {
    const prev = prevLevels[id];
    if (!prev) {
      changed = true;
      break;
    }

    if (!approxEqual(prev.rmsDb, levels.rmsDb) || !approxEqual(prev.peakDb, levels.peakDb)) {
      changed = true;
      break;
    }
  }

  if (!changed && Object.keys(prevLevels).length === Object.keys(nextLevels).length) {
    return;
  }

  params.timelineStore.audioLevels = nextLevels;
}
