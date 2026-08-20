import { normalizeTicks } from '~/utils/time';
import type { useProjectStore } from '~/stores/project.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import type { ClipEffect, TimelineTrack } from '~/timeline/types';
import type { TimelineFormatInput } from '~/timeline/format';
import { computeAudioDurationTicks } from './useMonitorCore.helpers';
import {
  prepareMonitorTimelineData,
  type PreparedMonitorTimelineData,
} from './useMonitorCore.payload';

export interface PreparedMonitorTimelineState extends PreparedMonitorTimelineData {
  audioDurationTicks: number;
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
    audioDurationTicks: computeAudioDurationTicks(preparedTimeline.flattenedAudio),
  };
}

export function computeMonitorTimelineDuration(params: {
  currentDurationTicks: number;
  maxDurationTicks: number;
  audioDurationTicks: number;
  normalize?: boolean;
}): number {
  const nextDurationTicks = Math.max(params.maxDurationTicks, params.audioDurationTicks);

  return params.normalize ? normalizeTicks(nextDurationTicks) : nextDurationTicks;
}
