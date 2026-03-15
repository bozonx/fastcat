import {
  buildVideoWorkerPayloadFromTracks,
  toWorkerTimelineClips,
} from '~/composables/timeline/export';
import type { useProjectStore } from '~/stores/project.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineTrack, TimelineTrackItem, ClipEffect } from '~/timeline/types';
import type { WorkerTimelineClip } from './types';

export interface PreparedMonitorTimelineData {
  flattenedClips: WorkerTimelineClip[];
  flattenedAudio: WorkerTimelineClip[];
  payload: (WorkerTimelineClip | { kind: 'meta' | 'track'; [key: string]: any })[];
}

export function createMockAudioItems(audioClips: WorkerTimelineClip[]): TimelineTrackItem[] {
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
    name: clip.id,
  })) as TimelineTrackItem[];
}

export async function prepareMonitorTimelineData(params: {
  rawAudioClips: WorkerTimelineClip[];
  tracks: TimelineTrack[];
  projectStore: ReturnType<typeof useProjectStore>;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  masterEffects?: ClipEffect[];
}): Promise<PreparedMonitorTimelineData> {
  const builtVideo = await buildVideoWorkerPayloadFromTracks({
    tracks: params.tracks,
    projectStore: params.projectStore,
    workspaceStore: params.workspaceStore,
    masterEffects: params.masterEffects,
  });
  const flattenedAudio = await toWorkerTimelineClips(
    createMockAudioItems(params.rawAudioClips),
    params.projectStore,
  );

  return {
    flattenedClips: builtVideo.clips,
    flattenedAudio,
    payload: builtVideo.payload,
  };
}
