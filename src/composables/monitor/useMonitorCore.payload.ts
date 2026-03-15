import {
  buildVideoWorkerPayloadFromTracks,
  toWorkerTimelineClips,
} from '~/composables/timeline/export';
import type { TimelineTrack, TimelineTrackItem, ClipEffect } from '~/timeline/types';
import type { WorkerTimelineClip } from './types';

export interface PreparedMonitorTimelineData {
  flattenedClips: WorkerTimelineClip[];
  flattenedAudio: WorkerTimelineClip[];
  payload: (WorkerTimelineClip | { kind: 'meta' | 'track'; [key: string]: any })[];
}

export function createMockAudioItems(audioClips: WorkerTimelineClip[]): unknown[] {
  return audioClips.map((clip) => ({
    kind: 'clip',
    clipType:
      clip.clipType === 'media' && clip.source?.path?.endsWith('.otio')
        ? 'timeline'
        : clip.clipType,
    id: clip.id,
    trackId: clip.trackId,
    speed: clip.speed,
    audioGain: clip.audioGain,
    audioBalance: clip.audioBalance,
    audioFadeInUs: clip.audioFadeInUs,
    audioFadeOutUs: clip.audioFadeOutUs,
    audioDeclickDurationUs: clip.audioDeclickDurationUs,
    source: clip.source,
    timelineRange: clip.timelineRange,
    sourceRange: clip.sourceRange,
    freezeFrameSourceUs: clip.freezeFrameSourceUs,
    opacity: clip.opacity,
    blendMode: clip.blendMode,
    effects: clip.effects,
    transform: clip.transform,
  }));
}

export async function prepareMonitorTimelineData(params: {
  rawAudioClips: WorkerTimelineClip[];
  tracks: TimelineTrack[];
  projectStore: unknown;
  workspaceStore: unknown;
  masterEffects?: ClipEffect[];
}): Promise<PreparedMonitorTimelineData> {
  const builtVideo = await buildVideoWorkerPayloadFromTracks({
    tracks: params.tracks,
    projectStore: params.projectStore as any,
    workspaceStore: params.workspaceStore as any,
    masterEffects: params.masterEffects,
  });
  const flattenedAudio = await toWorkerTimelineClips(
    createMockAudioItems(params.rawAudioClips) as unknown as TimelineTrackItem[],
    params.projectStore as any,
  );

  return {
    flattenedClips: builtVideo.clips,
    flattenedAudio,
    payload: builtVideo.payload,
  };
}
