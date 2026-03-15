import type { PreviewRenderOptions } from '~/utils/video-editor/worker-rpc';
import { cloneMonitorValue } from './useMonitorClone';
import type { WorkerTimelineClip } from './types';

export function cloneWorkerPayload<T>(value: T): T {
  return cloneMonitorValue(value);
}

export function computeAudioDurationUs(clips: WorkerTimelineClip[]): number {
  let maxEnd = 0;
  for (const clip of clips) {
    const end = clip.timelineRange.startUs + clip.timelineRange.durationUs;
    if (end > maxEnd) {
      maxEnd = end;
    }
  }
  return maxEnd;
}

export function createPreviewRenderOptions(params: {
  previewEffectsEnabled: boolean;
  videoFrameCacheMb: number;
}): PreviewRenderOptions {
  return {
    previewEffectsEnabled: params.previewEffectsEnabled,
    videoFrameCacheMb: params.videoFrameCacheMb,
  };
}

export function getAudioSourceKey(params: { path: string; useProxyInMonitor: boolean }): string {
  return `${params.useProxyInMonitor ? 'proxy' : 'source'}:${params.path}`;
}
