import {
  buildVideoWorkerPayloadFromTracks,
  toWorkerTimelineClips,
} from '~/composables/timeline/export';
import type { WorkerVideoPayloadItem } from '~/composables/timeline/export/types';
import type { useProjectStore } from '~/stores/project.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineTrack, ClipEffect, TimelineDocument } from '~/timeline/types';
import type { TimelineFormatInput } from '~/timeline/format';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';
import type { WorkerTimelineClip } from './types';

export interface PreparedMonitorTimelineData {
  flattenedClips: WorkerTimelineClip[];
  flattenedAudio: WorkerTimelineClip[];
  payload: WorkerVideoPayloadItem[];
}

/**
 * Build the worker payloads for the monitor straight from the timeline tracks.
 *
 * Both video and audio derive from the same `TimelineTrack[]` source through a
 * single `toWorkerTimelineClips` pass — the audio path mirrors the native
 * monitor's `buildAudioLayers` (track-bus → `toWorkerTimelineClips`) so the web
 * and native monitors agree on what an audio clip is. There is no intermediate
 * `WorkerTimelineClip → mock TimelineTrackItem → WorkerTimelineClip` round-trip.
 */
export async function prepareMonitorTimelineData(params: {
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

  const audioTracks = params.tracks.filter((track) => track.kind === 'audio');
  const videoTracks = params.tracks.filter((track) => track.kind === 'video');
  const effectiveAudioItems = buildEffectiveAudioClipItems({
    audioTracks,
    videoTracks,
    masterEffects: params.masterEffects,
  });
  const flattenedAudio = await toWorkerTimelineClips(
    effectiveAudioItems.items,
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
