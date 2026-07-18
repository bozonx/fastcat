import type { PreviewRenderOptions } from '~/utils/video-editor/worker-rpc';
import { cloneMonitorValue } from './useMonitorClone';
import type { WorkerTimelineClip } from './types';

import type { PreviewEffectQuality } from '~/utils/preview-effect-quality';

export function cloneWorkerPayload<T>(value: T): T {
  return cloneMonitorValue(value);
}

export function computeAudioDurationTicks(clips: WorkerTimelineClip[]): number {
  let maxEnd = 0;
  for (const clip of clips) {
    const end = clip.timelineRange.startTicks + clip.timelineRange.durationTicks;
    if (end > maxEnd) {
      maxEnd = end;
    }
  }
  return maxEnd;
}

export function createPreviewRenderOptions(params: {
  previewEffectsEnabled: boolean;
  pixiRenderer: 'webgl' | 'webgpu';
  videoFrameCacheMb: number;
  monitorSyncMode: 'smooth' | 'balanced' | 'strict';
  previewEffectQuality: PreviewEffectQuality;
}): PreviewRenderOptions {
  return {
    previewEffectsEnabled: params.previewEffectsEnabled,
    pixiRenderer: params.pixiRenderer,
    videoFrameCacheMb: params.videoFrameCacheMb,
    monitorSyncMode: params.monitorSyncMode,
    previewEffectQuality: params.previewEffectQuality,
  };
}

export function getAudioSourceKey(params: { path: string; useProxyInMonitor: boolean }): string {
  return `${params.useProxyInMonitor ? 'proxy' : 'source'}:${params.path}`;
}
