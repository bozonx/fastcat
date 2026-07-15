import { normalizeTicks } from '~/utils/time';
import type { useProjectStore } from '~/stores/project.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import type { ClipEffect, TimelineTrack } from '~/timeline/types';
import type { TimelineFormatInput } from '~/timeline/format';
import { computeAudioDurationUs } from './useMonitorCore.helpers';
import {
  prepareMonitorTimelineData,
  type PreparedMonitorTimelineData,
} from './useMonitorCore.payload';

export interface PreparedMonitorTimelineState extends PreparedMonitorTimelineData {
  audioDurationUs: number;
}

export async function prepareMonitorTimelineState(params: {
  tracks: TimelineTrack[];
  projectStore: ReturnType<typeof useProjectStore>;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  masterEffects?: ClipEffect[];
  fallbackFormat?: TimelineFormatInput;
}): Promise<PreparedMonitorTimelineState> {
  const preparedTimeline = await prepareMonitorTimelineData({
    tracks: params.tracks,
    projectStore: params.projectStore,
    workspaceStore: params.workspaceStore,
    masterEffects: params.masterEffects,
    fallbackFormat: params.fallbackFormat,
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
  const nextDurationUs = Math.max(params.maxDurationUs, params.audioDurationUs);

  return params.normalize ? normalizeTicks(nextDurationUs) : nextDurationUs;
}
