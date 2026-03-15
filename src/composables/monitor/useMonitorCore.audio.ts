import type { AudioEngineClip } from '~/utils/video-editor/audio-engine.types';
import type { AudioClipEffect, ClipEffect } from '~/timeline/types';
import type { WorkerTimelineClip } from './types';
import { getAudioSourceKey } from './useMonitorCore.helpers';

export interface MonitorAudioClipDescriptor extends AudioEngineClip {}

function isAudioClipEffect(effect: ClipEffect<Record<string, any>>): effect is AudioClipEffect {
  return effect?.target === 'audio';
}

export async function getFileHandleForAudio(params: {
  path: string;
  useProxyInMonitor: boolean;
  audioHandleCache: Map<string, FileSystemFileHandle>;
  getProxyFileHandle: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
}): Promise<FileSystemFileHandle | null> {
  const cacheKey = getAudioSourceKey({
    path: params.path,
    useProxyInMonitor: params.useProxyInMonitor,
  });
  const cached = params.audioHandleCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (params.useProxyInMonitor) {
    const proxyHandle = await params.getProxyFileHandle(params.path);
    if (proxyHandle) {
      params.audioHandleCache.set(cacheKey, proxyHandle);
      return proxyHandle;
    }
  }

  const handle = await params.getFileHandleByPath(params.path);
  if (!handle) {
    return null;
  }

  params.audioHandleCache.set(cacheKey, handle);
  return handle;
}

export async function mapAudioEngineClips(params: {
  clips: WorkerTimelineClip[];
  useProxyInMonitor: boolean;
  audioHandleCache: Map<string, FileSystemFileHandle>;
  getProxyFileHandle: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
}): Promise<MonitorAudioClipDescriptor[]> {
  const mappedClips = await Promise.all<MonitorAudioClipDescriptor | null>(
    params.clips.map(async (clip) => {
      try {
        const path = clip.source?.path;
        if (!path) {
          return null;
        }

        const handle = await getFileHandleForAudio({
          path,
          useProxyInMonitor: params.useProxyInMonitor,
          audioHandleCache: params.audioHandleCache,
          getProxyFileHandle: params.getProxyFileHandle,
          getFileHandleByPath: params.getFileHandleByPath,
        });
        if (!handle) {
          return null;
        }

        const mappedClip: MonitorAudioClipDescriptor = {
          id: clip.id,
          trackId: clip.trackId,
          sourcePath: getAudioSourceKey({
            path,
            useProxyInMonitor: params.useProxyInMonitor,
          }),
          fileHandle: handle,
          startUs: clip.timelineRange.startUs,
          durationUs: clip.timelineRange.durationUs,
          sourceStartUs: clip.sourceRange.startUs,
          sourceRangeDurationUs: clip.sourceRange.durationUs,
          sourceDurationUs: clip.sourceDurationUs ?? clip.sourceRange.durationUs,
          speed: clip.speed,
          audioGain: clip.audioGain,
          audioBalance: clip.audioBalance,
          audioFadeInUs: clip.audioFadeInUs,
          audioFadeOutUs: clip.audioFadeOutUs,
          audioEffects: (clip.effects ?? []).filter(isAudioClipEffect),
        };

        return mappedClip;
      } catch {
        return null;
      }
    }),
  );

  return mappedClips.filter((clip): clip is MonitorAudioClipDescriptor => clip !== null);
}
