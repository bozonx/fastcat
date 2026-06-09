import type { AudioEngineClip } from '~/utils/video-editor/audio-engine.types';
import type { WorkerTimelineClip } from './types';
import { getAudioSourceKey } from './useMonitorCore.helpers';
import { withFileIoSlot } from '~/utils/io/io-governor';
import {
  buildCanonicalAudioClipDescriptor,
  toAudioEngineClip,
} from '~/utils/audio/audio-clip-descriptor';

export type MonitorAudioClipDescriptor = AudioEngineClip;

/**
 * Canonical projection from the shared `WorkerTimelineClip` DTO to the audio
 * engine's `AudioEngineClip`. This is the single place that maps clip fields to
 * the audio engine; `mapAudioEngineClips` only adds the resolved file handle and
 * proxy-aware source key on top of this pure mapping.
 */
export function workerClipToAudioEngineClip(params: {
  clip: WorkerTimelineClip;
  sourcePath: string;
  fileHandle: FileSystemFileHandle;
}): MonitorAudioClipDescriptor {
  const { clip, sourcePath, fileHandle } = params;
  return toAudioEngineClip({
    descriptor: buildCanonicalAudioClipDescriptor({ clip, sourcePath }),
    fileHandle,
  });
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
    try {
      await withFileIoSlot(() => cached.getFile());
      return cached;
    } catch {
      params.audioHandleCache.delete(cacheKey);
    }
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

        return workerClipToAudioEngineClip({
          clip,
          sourcePath: getAudioSourceKey({
            path,
            useProxyInMonitor: params.useProxyInMonitor,
          }),
          fileHandle: handle,
        });
      } catch {
        return null;
      }
    }),
  );

  return mappedClips.filter((clip): clip is MonitorAudioClipDescriptor => clip !== null);
}
