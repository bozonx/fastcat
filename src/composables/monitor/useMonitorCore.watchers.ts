import type { Ref } from 'vue';
import type { WorkerTimelineClip } from './types';

export function hasProxyForMonitorSources(params: {
  clips: WorkerTimelineClip[];
  audioClips: WorkerTimelineClip[];
  existingProxies: Set<string>;
}): boolean {
  return [...params.clips, ...params.audioClips].some((clip) => {
    const path = clip.source?.path;
    if (!path) {
      return false;
    }

    return params.existingProxies.has(path);
  });
}

export function getMonitorLayoutUpdatePayload(params: {
  rawWorkerTimelineClips?: Ref<WorkerTimelineClip[]>;
  rawWorkerAudioClips?: Ref<WorkerTimelineClip[]>;
  workerTimelineClips: Ref<WorkerTimelineClip[]>;
  workerAudioClips: Ref<WorkerTimelineClip[]>;
}): {
  layoutClips: WorkerTimelineClip[];
  layoutAudioClips: WorkerTimelineClip[];
} {
  return {
    layoutClips: params.rawWorkerTimelineClips?.value ?? params.workerTimelineClips.value,
    layoutAudioClips: params.rawWorkerAudioClips?.value ?? params.workerAudioClips.value,
  };
}

export function shouldScheduleClipLayoutUpdate(params: {
  isLoading: boolean;
  isCompositorReady: boolean;
  clipSourceSignature: number;
  lastBuiltSourceSignature: number;
  clipLayoutSignature: number;
  lastBuiltLayoutSignature: number;
  layoutUpdateFromQueue: boolean;
}): boolean {
  if (params.isLoading || !params.isCompositorReady) {
    return false;
  }

  if (params.clipSourceSignature !== params.lastBuiltSourceSignature) {
    return false;
  }

  if (params.clipLayoutSignature === params.lastBuiltLayoutSignature) {
    return false;
  }

  if (params.layoutUpdateFromQueue) {
    return false;
  }

  return true;
}

export function shouldScheduleAudioLayoutUpdate(params: {
  isLoading: boolean;
  isCompositorReady: boolean;
}): boolean {
  return !params.isLoading && params.isCompositorReady;
}
