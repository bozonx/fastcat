import {
  buildVideoWorkerPayloadFromTracks,
  toWorkerTimelineClips,
} from '~/composables/timeline/export';
import type { WorkerVideoPayloadItem } from '~/composables/timeline/export/types';
import type { useProjectStore } from '~/stores/project.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import type {
  TimelineTrack,
  TimelineTrackItem,
  ClipEffect,
  TimelineDocument,
} from '~/timeline/types';
import type { TimelineFormatInput } from '~/timeline/format';
import type { WorkerTimelineClip } from './types';

export interface PreparedMonitorTimelineData {
  flattenedClips: WorkerTimelineClip[];
  flattenedAudio: WorkerTimelineClip[];
  payload: WorkerVideoPayloadItem[];
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
    audioFadeInCurve: clip.audioFadeInCurve,
    audioFadeOutCurve: clip.audioFadeOutCurve,
    audioDeclickDurationUs: clip.audioDeclickDurationUs,
    transitionIn: clip.transitionIn,
    transitionOut: clip.transitionOut,
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
  fallbackFormat?: TimelineFormatInput;
}): Promise<PreparedMonitorTimelineData> {
  const nestedDocCache = new Map<string, TimelineDocument>();
  const builtVideo = await buildVideoWorkerPayloadFromTracks({
    tracks: params.tracks,
    projectStore: params.projectStore,
    workspaceStore: params.workspaceStore,
    masterEffects: params.masterEffects,
    fallbackFormat: params.fallbackFormat,
    nestedDocCache,
  });
  const flattenedAudio = await toWorkerTimelineClips(
    createMockAudioItems(params.rawAudioClips),
    params.projectStore,
    params.workspaceStore,
    {
      trackKind: 'audio',
      fallbackFormat: params.fallbackFormat,
      nestedDocCache,
    },
  );

  return {
    flattenedClips: builtVideo.clips,
    flattenedAudio,
    payload: builtVideo.payload,
  };
}
