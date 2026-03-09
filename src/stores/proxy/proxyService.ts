import type PQueue from 'p-queue';
import type { Ref } from 'vue';

import { VIDEO_DIR_NAME } from '~/utils/constants';
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';

export interface ProxyService {
  checkExistingProxies: (paths: string[]) => Promise<void>;
  generateProxy: (
    fileHandle: FileSystemFileHandle,
    projectRelativePath: string,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
  generateProxiesForFolder: (input: {
    dirHandle: FileSystemDirectoryHandle;
    dirPath: string;
  }) => Promise<void>;
  cancelProxyGeneration: (projectRelativePath: string) => Promise<void>;
  deleteProxy: (projectRelativePath: string) => Promise<void>;
  getProxyFileHandle: (projectRelativePath: string) => Promise<FileSystemFileHandle | null>;
  getProxyFile: (projectRelativePath: string) => Promise<File | null>;
}

export function createProxyService(params: {
  videoExtensions: Set<string>;

  generatingProxies: Ref<Set<string>>;
  existingProxies: Ref<Set<string>>;
  proxyProgress: Ref<Record<string, number>>;
  proxyAbortControllers: Ref<Record<string, AbortController>>;
  activeWorkerPaths: Ref<Set<string>>;

  proxyQueue: Ref<PQueue>;

  ensureProjectProxiesDir: () => Promise<FileSystemDirectoryHandle | null>;
  getProxyFileName: (projectRelativePath: string) => string;

  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath: (path: string) => Promise<File | null>;

  getOptimizationSettings: () => {
    proxyResolution: string;
    proxyVideoBitrateMbps: number;
    proxyAudioBitrateKbps: number;
    proxyCopyOpusAudio: boolean;
  };
}): ProxyService {
  async function generateProxiesForFolder(input: {
    dirHandle: FileSystemDirectoryHandle;
    dirPath: string;
  }): Promise<void> {
    params.generatingProxies.value.add(input.dirPath);
    try {
      const iterator = (input.dirHandle as any).values?.() ?? (input.dirHandle as any).entries?.();
      if (!iterator) return;

      for await (const value of iterator) {
        const handle = (Array.isArray(value) ? value[1] : value) as
          | FileSystemFileHandle
          | FileSystemDirectoryHandle;
        const fullPath = input.dirPath ? `${input.dirPath}/${handle.name}` : handle.name;

        if (handle.kind === 'file') {
          const ext = handle.name.split('.').pop()?.toLowerCase() ?? '';
          if (!params.videoExtensions.has(ext)) continue;
          if (params.existingProxies.value.has(fullPath)) continue;

          try {
            await generateProxy(handle as FileSystemFileHandle, fullPath);
          } catch (e) {
            console.warn('Failed to generate proxy for file', fullPath, e);
          }
        }
      }
    } finally {
      params.generatingProxies.value.delete(input.dirPath);
    }
  }

  async function checkExistingProxies(paths: string[]) {
    const dir = await params.ensureProjectProxiesDir();
    if (!dir) return;

    const next = new Set(params.existingProxies.value);
    for (const path of paths) {
      if (!path.startsWith(`${VIDEO_DIR_NAME}/`)) continue;
      try {
        const handle = await dir.getFileHandle(params.getProxyFileName(path));
        // Check that the proxy file is not empty (e.g. left by a cancelled generation)
        const file = await handle.getFile();
        if (file.size > 0) {
          next.add(path);
        } else {
          next.delete(path);
        }
      } catch {
        next.delete(path);
      }
    }
    params.existingProxies.value = next;
  }

  async function generateProxy(
    fileHandle: FileSystemFileHandle,
    projectRelativePath: string,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    if (!projectRelativePath.startsWith(`${VIDEO_DIR_NAME}/`)) return;

    // Wait if currently generating (e.g. cancellation still in progress)
    if (params.generatingProxies.value.has(projectRelativePath)) return;

    const dir = await params.ensureProjectProxiesDir();
    if (!dir) throw new Error('Could not access proxies directory');

    params.generatingProxies.value.add(projectRelativePath);
    params.proxyProgress.value[projectRelativePath] = 0;

    const controller = new AbortController();
    params.proxyAbortControllers.value = {
      ...params.proxyAbortControllers.value,
      [projectRelativePath]: controller,
    };

    const signal = options?.signal;
    const onAbort = () => {
      controller.abort();
    };

    if (signal) {
      if (signal.aborted) controller.abort();
      else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    let proxyFileHandle: FileSystemFileHandle | null = null;

    try {
      await params.proxyQueue.value.add(async () => {
        try {
          if (controller.signal.aborted) {
            const abortErr = new Error('Proxy generation cancelled');
            (abortErr as any).name = 'AbortError';
            throw abortErr;
          }

          params.activeWorkerPaths.value.add(projectRelativePath);

          const proxyFilename = params.getProxyFileName(projectRelativePath);
          proxyFileHandle = await dir.getFileHandle(proxyFilename, { create: true });

          const optimization = params.getOptimizationSettings();

          let width = 1280;
          let height = 720;
          if (optimization.proxyResolution === '360p') {
            width = 640;
            height = 360;
          } else if (optimization.proxyResolution === '480p') {
            width = 854;
            height = 480;
          } else if (optimization.proxyResolution === '1080p') {
            width = 1920;
            height = 1080;
          }

          const { client } = getExportWorkerClient();

          setExportHostApi(
            createVideoCoreHostApi({
              getCurrentProjectId: () => null,
              getWorkspaceHandle: () => null,
              getFileHandleByPath: async (path) => await params.getFileHandleByPath(path),
              getFileByPath: async (path) => await params.getFileByPath(path),
              onExportProgress: (progress) => {
                params.proxyProgress.value[projectRelativePath] = progress;
              },
            }),
          );

          const meta = await client.extractMetadata(fileHandle);
          const durationUs = Math.round((meta.duration || 0) * 1_000_000);

          if (!durationUs) throw new Error('Invalid video duration');

          const videoClips = [
            {
              kind: 'clip',
              id: 'proxy_video',
              layer: 0,
              source: { path: projectRelativePath },
              timelineRange: { startUs: 0, durationUs },
              sourceRange: { startUs: 0, durationUs },
            },
          ];

          const audioClips = meta.audio
            ? [
                {
                  kind: 'clip',
                  id: 'proxy_audio',
                  layer: 0,
                  source: { path: projectRelativePath },
                  timelineRange: { startUs: 0, durationUs },
                  sourceRange: { startUs: 0, durationUs },
                },
              ]
            : [];

          const isOpusAudio =
            typeof meta.audio?.codec === 'string' &&
            meta.audio.codec.toLowerCase().startsWith('opus');

          const exportOptions = {
            format: 'webm',
            videoCodec: 'vp09.00.10.08',
            bitrate: optimization.proxyVideoBitrateMbps * 1_000_000,
            audioBitrate: optimization.proxyAudioBitrateKbps * 1000,
            audio: !!meta.audio,
            audioCodec: 'opus',
            audioPassthrough: optimization.proxyCopyOpusAudio && isOpusAudio,
            width,
            height,
            fps: meta.video?.fps || 30,
          };

          await (client as any).exportTimeline(
            proxyFileHandle,
            exportOptions,
            videoClips,
            audioClips,
          );

          params.existingProxies.value = new Set([
            ...params.existingProxies.value,
            projectRelativePath,
          ]);
        } catch (innerErr) {
          // Remove the incomplete proxy file on abort or error
          if (proxyFileHandle) {
            try {
              await dir.removeEntry(params.getProxyFileName(projectRelativePath));
            } catch {
              // Best-effort cleanup
            }
            proxyFileHandle = null;
          }
          throw innerErr;
        } finally {
          params.activeWorkerPaths.value.delete(projectRelativePath);
          params.generatingProxies.value.delete(projectRelativePath);
          delete params.proxyProgress.value[projectRelativePath];

          if (signal) {
            try {
              signal.removeEventListener('abort', onAbort);
            } catch {
              // ignore
            }
          }

          const nextControllers = { ...params.proxyAbortControllers.value };
          delete nextControllers[projectRelativePath];
          params.proxyAbortControllers.value = nextControllers;
        }
      });
    } catch (e) {
      if ((e as any)?.name === 'AbortError') {
        return;
      }
      params.generatingProxies.value.delete(projectRelativePath);
      delete params.proxyProgress.value[projectRelativePath];

      const nextControllers = { ...params.proxyAbortControllers.value };
      delete nextControllers[projectRelativePath];
      params.proxyAbortControllers.value = nextControllers;
      throw e;
    }
  }

  async function cancelProxyGeneration(projectRelativePath: string) {
    const controller = params.proxyAbortControllers.value[projectRelativePath];
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }

    if (params.activeWorkerPaths.value.has(projectRelativePath)) {
      try {
        const { client } = getExportWorkerClient();
        await client.cancelExport();
      } catch {
        // ignore
      }
    }
  }

  async function deleteProxy(projectRelativePath: string) {
    if (!projectRelativePath.startsWith(`${VIDEO_DIR_NAME}/`)) return;
    const dir = await params.ensureProjectProxiesDir();
    if (!dir) return;

    try {
      await dir.removeEntry(params.getProxyFileName(projectRelativePath));
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'NotFoundError') {
        console.warn('Failed to delete proxy', e);
        return;
      }
      // NotFoundError: file already gone, still clean up state
    }

    // Replace with a new Set to guarantee Vue reactivity
    const next = new Set(params.existingProxies.value);
    next.delete(projectRelativePath);
    params.existingProxies.value = next;
  }

  async function getProxyFileHandle(
    projectRelativePath: string,
  ): Promise<FileSystemFileHandle | null> {
    if (!projectRelativePath.startsWith(`${VIDEO_DIR_NAME}/`)) return null;
    const dir = await params.ensureProjectProxiesDir();
    if (!dir) return null;

    try {
      return await dir.getFileHandle(params.getProxyFileName(projectRelativePath));
    } catch {
      return null;
    }
  }

  async function getProxyFile(projectRelativePath: string): Promise<File | null> {
    if (!projectRelativePath.startsWith(`${VIDEO_DIR_NAME}/`)) return null;
    const dir = await params.ensureProjectProxiesDir();
    if (!dir) return null;

    try {
      const handle = await dir.getFileHandle(params.getProxyFileName(projectRelativePath));
      return await handle.getFile();
    } catch {
      return null;
    }
  }

  return {
    checkExistingProxies,
    generateProxy,
    generateProxiesForFolder,
    cancelProxyGeneration,
    deleteProxy,
    getProxyFileHandle,
    getProxyFile,
  };
}
