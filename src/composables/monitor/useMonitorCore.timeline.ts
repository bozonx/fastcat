import { normalizeTimeUs } from '~/utils/monitor-time';
import type { useProjectStore } from '~/stores/project.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import type { ClipEffect, TimelineTrack } from '~/timeline/types';
import type { WorkerTimelineClip } from './types';
import { computeAudioDurationUs } from './useMonitorCore.helpers';
import {
  prepareMonitorTimelineData,
  type PreparedMonitorTimelineData,
} from './useMonitorCore.payload';

export interface PreparedMonitorTimelineState extends PreparedMonitorTimelineData {
  audioDurationUs: number;
}

export async function prepareMonitorTimelineState(params: {
  rawAudioClips: WorkerTimelineClip[];
  tracks: TimelineTrack[];
  projectStore: ReturnType<typeof useProjectStore>;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  masterEffects?: ClipEffect[];
}): Promise<PreparedMonitorTimelineState> {
  const preparedTimeline = await prepareMonitorTimelineData({
    rawAudioClips: params.rawAudioClips,
    tracks: params.tracks,
    projectStore: params.projectStore,
    workspaceStore: params.workspaceStore,
    masterEffects: params.masterEffects,
  });

  return {
    ...preparedTimeline,
    audioDurationUs: computeAudioDurationUs(preparedTimeline.flattenedAudio),
  };
}

export function computeMonitorTimelineDuration(params: {
  currentDurationUs: number;
  maxDurationUs: number;
  audioDurationUs: number;
  normalize?: boolean;
}): number {
  const nextDurationUs = Math.max(
    params.currentDurationUs,
    params.maxDurationUs,
    params.audioDurationUs,
  );

  return params.normalize ? normalizeTimeUs(nextDurationUs) : nextDurationUs;
}
