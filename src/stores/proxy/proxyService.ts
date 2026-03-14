import type PQueue from 'p-queue';
import type { Ref } from 'vue';

import { VIDEO_DIR_NAME } from '~/utils/constants';
import { getProxyWorkerClient, setProxyHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';

export interface ProxyService {
  checkExistingProxies: (paths: string[]) => Promise<void>;
  generateProxy: (
    file: File | FileSystemFileHandle,
    projectRelativePath: string,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
  generateProxiesForFolder: (input: {
    dirHandle: FileSystemDirectoryHandle;
    dirPath: string;
  }) => Promise<void>;
  cancelProxyGeneration: (projectRelativePath: string) => Promise<void>;
  deleteProxy: (projectRelativePath: string) => Promise<void>;
  renameProxy: (params: { oldPath: string; newPath: string }) => Promise<void>;
  renameProxyDir: (params: { oldPath: string; newPath: string }) => Promise<void>;
  getProxyFileHandle: (projectRelativePath: string) => Promise<FileSystemFileHandle | null>;
  getProxyFile: (projectRelativePath: string) => Promise<File | null>;
}

export function createProxyService(params: {
  videoExtensions: Set<string>;

  generatingProxies: Ref<Set<string>>;
  existingProxies: Ref<Set<string>>;
  proxyProgress: Ref<Map<string, number>>;
  proxyAbortControllers: Ref<Map<string, AbortController>>;
  activeWorkerPaths: Ref<Set<string>>;
  proxyTaskIds: Ref<Map<string, string>>;
  taskIdToPath: Ref<Map<string, string>>;

  proxyQueue: Ref<PQueue>;

  ensureProjectProxiesDir: () => Promise<FileSystemDirectoryHandle | null>;
  getProxyFileName: (projectRelativePath: string) => Promise<string>;

  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath: (path: string) => Promise<File | null>;

  getOptimizationSettings: () => {
    proxyMaxPixels: number;
    proxyVideoBitrateMbps: number;
    proxyAudioBitrateKbps: number;
    proxyCopyOpusAudio: boolean;
  };

  backgroundTasksStore: any;
}): ProxyService {
  params.proxyTaskIds.value.clear(); // Clear old task mappings on service creation
  params.taskIdToPath.value.clear();

  setProxyHostApi(
    createVideoCoreHostApi({
      getCurrentProjectId: () => '',
      getWorkspaceHandle: () => null,
      getFileHandleByPath: params.getFileHandleByPath,
      getFileByPath: params.getFileByPath,
      onExportProgress: (progress: number, taskId?: string) => {
        if (!taskId) return;
        const path = params.taskIdToPath.value.get(taskId);
        if (path) {
          const nextProgress = new Map(params.proxyProgress.value);
          nextProgress.set(path, progress);
          params.proxyProgress.value = nextProgress;
          const bgTaskId = (params.proxyAbortControllers.value.get(path) as any)?.bgTaskId;
          if (bgTaskId) {
            params.backgroundTasksStore.updateTaskProgress(bgTaskId, progress / 100);
          }
        }
      },
      onExportPhase: (phase: 'encoding' | 'saving', taskId?: string) => {
        console.log(`[Proxy Worker] Phase: ${phase} for task ${taskId}`);
      },
      onExportWarning: (msg: string, taskId?: string) => {
        console.warn(`[Proxy Worker] Warning: ${msg} for task ${taskId}`);
      },
    }),
  );

  async function generateProxiesForFolder(input: {
    dirHandle: FileSystemDirectoryHandle;
    dirPath: string;
  }): Promise<void> {
    params.generatingProxies.value = new Set([...params.generatingProxies.value, input.dirPath]);
    try {
      for await (const handle of (input.dirHandle as any).values()) {
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
      const nextGenerating = new Set(params.generatingProxies.value);
      nextGenerating.delete(input.dirPath);
      params.generatingProxies.value = nextGenerating;
    }
  }

  async function checkExistingProxies(paths: string[]) {
    const dir = await params.ensureProjectProxiesDir();
    if (!dir) return;

    const next = new Set(params.existingProxies.value);
    for (const path of paths) {
      if (!path.startsWith(`${VIDEO_DIR_NAME}/`)) continue;
      try {
        const proxyFilename = await params.getProxyFileName(path);
        const handle = await dir.getFileHandle(proxyFilename);
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
    file: File | FileSystemFileHandle,
    projectRelativePath: string,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    if (!projectRelativePath.startsWith(`${VIDEO_DIR_NAME}/`)) return;

    // Wait if currently generating (e.g. cancellation still in progress)
    if (params.generatingProxies.value.has(projectRelativePath)) return;

    const dir = await params.ensureProjectProxiesDir();
    if (!dir) throw new Error('Could not access proxies directory');

    params.generatingProxies.value = new Set([
      ...params.generatingProxies.value,
      projectRelativePath,
    ]);
    params.proxyProgress.value = new Map(params.proxyProgress.value).set(projectRelativePath, 0);

    const controller = new AbortController();

    // Add to background tasks
    const bgTaskId = params.backgroundTasksStore.addTask({
      type: 'proxy',
      title: `Generating proxy: ${projectRelativePath.split('/').pop()}`,
      cancel: async () => {
        await cancelProxyGeneration(projectRelativePath);
      },
    });
    (controller as any).bgTaskId = bgTaskId;

    params.proxyAbortControllers.value = new Map(params.proxyAbortControllers.value).set(
      projectRelativePath,
      controller,
    );

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

          const taskId = `proxy-${projectRelativePath}-${Date.now()}`;
          params.proxyTaskIds.value = new Map(params.proxyTaskIds.value).set(
            projectRelativePath,
            taskId,
          );
          params.taskIdToPath.value = new Map(params.taskIdToPath.value).set(
            taskId,
            projectRelativePath,
          );
          params.activeWorkerPaths.value = new Set([
            ...params.activeWorkerPaths.value,
            projectRelativePath,
          ]);
          const proxyFilename = await params.getProxyFileName(projectRelativePath);
          proxyFileHandle = await dir.getFileHandle(proxyFilename, { create: true });

          const optimization = params.getOptimizationSettings();

          const { client } = getProxyWorkerClient();

          const meta = await client.extractMetadata(file);
          const sourceWidth = meta.video?.width || 1920;
          const sourceHeight = meta.video?.height || 1080;

          const sourcePixels = sourceWidth * sourceHeight;
          const targetPixels = optimization.proxyMaxPixels;

          let scale = 1.0;
          if (sourcePixels > targetPixels) {
            scale = Math.sqrt(targetPixels / sourcePixels);
            // Snap to common scales for efficiency
            const commonScales = [0.5, 0.25, 0.125, 0.0625];
            for (const s of commonScales) {
              if (s >= scale * 0.8 && s <= scale * 1.2) {
                scale = s;
                break;
              }
            }
          }

          // Ensure minimum dimensions and even numbers for codecs
          const width = Math.max(16, Math.round((sourceWidth * scale) / 2) * 2);
          const height = Math.max(16, Math.round((sourceHeight * scale) / 2) * 2);

          const durationUs = Math.round((meta.duration || 0) * 1_000_000);

          if (!durationUs) throw new Error('Invalid video duration');

          const videoClips = [
            {
              kind: 'clip' as const,
              id: 'proxy_video',
              layer: 0,
              source: { path: projectRelativePath },
              timelineRange: { startUs: 0, durationUs },
              sourceRange: { startUs: 0, durationUs },
            },
          ] as any;

          const audioClips = meta.audio
            ? ([
                {
                  kind: 'clip' as const,
                  id: 'proxy_audio',
                  layer: 0,
                  source: { path: projectRelativePath },
                  timelineRange: { startUs: 0, durationUs },
                  sourceRange: { startUs: 0, durationUs },
                },
              ] as any)
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

          await client.exportTimeline(
            proxyFileHandle,
            exportOptions,
            videoClips,
            audioClips,
            taskId,
          );

          params.existingProxies.value = new Set([
            ...params.existingProxies.value,
            projectRelativePath,
          ]);

          if (bgTaskId) {
            params.backgroundTasksStore.updateTaskStatus(bgTaskId, 'completed');
          }
        } catch (innerErr) {
          // Remove the incomplete proxy file on abort or error
          if (proxyFileHandle) {
            try {
              const proxyFilename = await params.getProxyFileName(projectRelativePath);
              await dir.removeEntry(proxyFilename);
            } catch {
              // Best-effort cleanup
            }
            proxyFileHandle = null;
          }
          if (bgTaskId) {
            params.backgroundTasksStore.updateTaskStatus(bgTaskId, 'failed', String(innerErr));
          }
          throw innerErr;
        } finally {
          const nextActiveWorkerPaths = new Set(params.activeWorkerPaths.value);
          nextActiveWorkerPaths.delete(projectRelativePath);
          params.activeWorkerPaths.value = nextActiveWorkerPaths;

          const nextGenerating = new Set(params.generatingProxies.value);
          nextGenerating.delete(projectRelativePath);
          params.generatingProxies.value = nextGenerating;

          const nextProgress = new Map(params.proxyProgress.value);
          nextProgress.delete(projectRelativePath);
          params.proxyProgress.value = nextProgress;

          const taskId = params.proxyTaskIds.value.get(projectRelativePath);
          if (taskId) {
            const nextTaskIdToPath = new Map(params.taskIdToPath.value);
            nextTaskIdToPath.delete(taskId);
            params.taskIdToPath.value = nextTaskIdToPath;

            const nextProxyTaskIds = new Map(params.proxyTaskIds.value);
            nextProxyTaskIds.delete(projectRelativePath);
            params.proxyTaskIds.value = nextProxyTaskIds;
          }

          if (signal) {
            try {
              signal.removeEventListener('abort', onAbort);
            } catch {
              // ignore
            }
          }
          const nextAbortControllers = new Map(params.proxyAbortControllers.value);
          nextAbortControllers.delete(projectRelativePath);
          params.proxyAbortControllers.value = nextAbortControllers;
        }
      });
    } catch (e) {
      if ((e as any)?.name === 'AbortError') {
        return;
      }
      const nextGenerating = new Set(params.generatingProxies.value);
      nextGenerating.delete(projectRelativePath);
      params.generatingProxies.value = nextGenerating;

      const nextProgress = new Map(params.proxyProgress.value);
      nextProgress.delete(projectRelativePath);
      params.proxyProgress.value = nextProgress;

      const nextAbortControllers = new Map(params.proxyAbortControllers.value);
      nextAbortControllers.delete(projectRelativePath);
      params.proxyAbortControllers.value = nextAbortControllers;
      throw e;
    }
  }

  async function cancelProxyGeneration(projectRelativePath: string) {
    const controller = params.proxyAbortControllers.value.get(projectRelativePath);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }

    const taskId = params.proxyTaskIds.value.get(projectRelativePath);
    if (taskId && params.activeWorkerPaths.value.has(projectRelativePath)) {
      try {
        const { client } = getProxyWorkerClient();
        await client.cancelExport(taskId);
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
      const proxyFilename = await params.getProxyFileName(projectRelativePath);
      await dir.removeEntry(proxyFilename);
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'NotFoundError') {
        console.warn('Failed to delete proxy', e);
        return;
      }
    }

    const next = new Set(params.existingProxies.value);
    next.delete(projectRelativePath);
    params.existingProxies.value = next;
  }

  async function renameProxyDir(input: { oldPath: string; newPath: string }) {
    const dir = await params.ensureProjectProxiesDir();
    if (!dir) return;

    const oldPrefix = `${input.oldPath}/`;

    // 1. Cancel active/pending tasks
    for (const path of params.proxyAbortControllers.value.keys()) {
      if (path.startsWith(oldPrefix)) {
        await cancelProxyGeneration(path);
      }
    }

    // 2. Rename existing proxy files
    const affectedPaths = Array.from(params.existingProxies.value).filter((p) =>
      p.startsWith(oldPrefix),
    );

    for (const oldPath of affectedPaths) {
      const relative = oldPath.substring(oldPrefix.length);
      const newPath = `${input.newPath}/${relative}`;
      await renameProxy({ oldPath, newPath });
    }
  }

  async function renameProxy(input: { oldPath: string; newPath: string }) {
    if (!input.oldPath.startsWith(`${VIDEO_DIR_NAME}/`)) return;
    const dir = await params.ensureProjectProxiesDir();
    if (!dir) return;

    try {
      const oldFilename = await params.getProxyFileName(input.oldPath);
      const newFilename = await params.getProxyFileName(input.newPath);

      const handle = await dir.getFileHandle(oldFilename);
      if ((handle as any).move) {
        await (handle as any).move(newFilename);
      } else {
        // Fallback: copy and delete if move is not supported (unlikely in modern Chrome)
        const newHandle = await dir.getFileHandle(newFilename, { create: true });
        const writable = await (newHandle as any).createWritable();
        await writable.write(await handle.getFile());
        await writable.close();
        await dir.removeEntry(oldFilename);
      }

      const next = new Set(params.existingProxies.value);
      next.delete(input.oldPath);
      if (input.newPath.startsWith(`${VIDEO_DIR_NAME}/`)) {
        next.add(input.newPath);
      }
      params.existingProxies.value = next;
    } catch (e) {
      console.warn('Failed to rename proxy', e);
      // Clean up if rename failed
      const next = new Set(params.existingProxies.value);
      next.delete(input.oldPath);
      params.existingProxies.value = next;
    }
  }

  async function getProxyFileHandle(
    projectRelativePath: string,
  ): Promise<FileSystemFileHandle | null> {
    if (!projectRelativePath.startsWith(`${VIDEO_DIR_NAME}/`)) return null;
    const dir = await params.ensureProjectProxiesDir();
    if (!dir) return null;

    try {
      const proxyFilename = await params.getProxyFileName(projectRelativePath);
      return await dir.getFileHandle(proxyFilename);
    } catch {
      return null;
    }
  }

  async function getProxyFile(projectRelativePath: string): Promise<File | null> {
    if (!projectRelativePath.startsWith(`${VIDEO_DIR_NAME}/`)) return null;
    const dir = await params.ensureProjectProxiesDir();
    if (!dir) return null;

    try {
      const proxyFilename = await params.getProxyFileName(projectRelativePath);
      const handle = await dir.getFileHandle(proxyFilename);
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
    renameProxy,
    renameProxyDir,
    getProxyFileHandle,
    getProxyFile,
  };
}
