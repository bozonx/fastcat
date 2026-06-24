import { createDevLogger } from '~/utils/dev-logger';
import type PQueue from 'p-queue';
import type { Ref } from 'vue';

import { VIDEO_DIR_NAME } from '~/utils/constants';
import { MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';
import { getProxyWorkerClient, setProxyHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import type { BackgroundTasksStore } from '~/stores/background-tasks.store';
import { isTauriRuntime } from '~/utils/runtime';
import {
  getNativeFileHandlePath,
  nativeCancelMediaTask,
  nativeGenerateProxy,
  nativeMediaMetadata,
} from '~/utils/tauri-media-processing';
import { normalizeMediaCachePath } from '~/utils/path';
const log = createDevLogger('proxyService');

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
  generateProxiesBatch: (
    entries: { file: File | FileSystemFileHandle; projectRelativePath: string }[],
    options?: { signal?: AbortSignal },
  ) => Promise<{ skippedCount: number }>;
  deleteProxiesBatch: (projectRelativePaths: string[]) => Promise<void>;
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
  bgTaskIdsByPath: Ref<Map<string, string>>;

  proxyQueue: Ref<PQueue>;

  /** VFS path to the project proxies directory, or null when no project is open. */
  getProjectProxiesVfsPath: () => string | null;
  getProxyFileName: (projectRelativePath: string) => Promise<string>;
  /** Full VFS path to a specific proxy file, or null when no project is open. */
  getProxyFilePath: (projectRelativePath: string) => Promise<string | null>;
  /** Lazy VFS accessor (plugin initializes after stores). */
  getVfs: () => IFileSystemAdapter;

  /**
   * Tier-3 bridge: obtain a raw FileSystemFileHandle for the proxy output
   * file. The WebCodecs worker needs it for `createWritable()` streaming
   * writes. This is the single remaining handle-crossing point and will be
   * removed when the worker RPC layer migrates to VFS-native streaming.
   */
  getWriteFileHandle: (proxyVfsPath: string) => Promise<FileSystemFileHandle | null>;

  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath: (path: string) => Promise<File | null>;

  getOptimizationSettings: () => {
    proxyMaxPixels: number;
    proxyVideoBitrateMbps: number;
    proxyAudioBitrateKbps: number;
    proxyCopyOpusAudio: boolean;
  };

  getProxyTaskTitle: (input: { fileName: string; projectRelativePath: string }) => string;

  backgroundTasksStore: Pick<
    BackgroundTasksStore,
    'addTask' | 'updateTaskStatus' | 'updateTaskProgress'
  >;
}): ProxyService {
  params.proxyTaskIds.value.clear(); // Clear old task mappings on service creation
  params.taskIdToPath.value.clear();
  params.bgTaskIdsByPath.value.clear();

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
          const bgTaskId = params.bgTaskIdsByPath.value.get(path);
          if (bgTaskId) {
            params.backgroundTasksStore.updateTaskProgress(bgTaskId, progress / 100);
          }
        }
      },
      onExportPhase: (phase: 'encoding' | 'finalizing', taskId?: string) => {
        if (!taskId || phase !== 'finalizing') return;
        const path = params.taskIdToPath.value.get(taskId);
        if (!path) return;
        const bgTaskId = params.bgTaskIdsByPath.value.get(path);
        if (bgTaskId) {
          params.backgroundTasksStore.updateTaskProgress(bgTaskId, 0.99);
        }
      },
      onExportWarning: (msg: string, taskId?: string) => {
        log.warn(`[Proxy Worker] Warning: ${msg} for task ${taskId}`);
      },
    }),
  );

  async function generateProxiesForFolder(input: {
    dirHandle: FileSystemDirectoryHandle;
    dirPath: string;
  }): Promise<void> {
    params.generatingProxies.value = new Set([...params.generatingProxies.value, input.dirPath]);
    const tasks: Promise<void>[] = [];
    try {
      for await (const handle of (
        input.dirHandle as unknown as {
          values: () => AsyncIterable<{ kind: string; name: string }>;
        }
      ).values()) {
        const fullPath = input.dirPath ? `${input.dirPath}/${handle.name}` : handle.name;

        if (handle.kind === 'file') {
          const ext = handle.name.split('.').pop()?.toLowerCase() ?? '';
          if (!params.videoExtensions.has(ext)) continue;
          if (params.existingProxies.value.has(fullPath)) continue;

          tasks.push(
            generateProxy(handle as FileSystemFileHandle, fullPath).catch((e) => {
              log.warn('Failed to generate proxy for file', fullPath, e);
            }),
          );
        }
      }

      await Promise.all(tasks);
    } finally {
      const nextGenerating = new Set(params.generatingProxies.value);
      nextGenerating.delete(input.dirPath);
      params.generatingProxies.value = nextGenerating;
    }
  }

  async function checkExistingProxies(paths: string[]) {
    const vfs = params.getVfs();
    const next = new Set(params.existingProxies.value);
    for (const rawPath of paths) {
      const path = normalizeMediaCachePath(rawPath);
      if (!path.startsWith(`${VIDEO_DIR_NAME}/`)) continue;
      try {
        const proxyFilePath = await params.getProxyFilePath(path);
        if (!proxyFilePath) {
          next.delete(path);
          continue;
        }
        const file = await vfs.getFile(proxyFilePath);
        if (file && file.size > 0) {
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
    options?: { signal?: AbortSignal; suppressBgTask?: boolean },
  ): Promise<void> {
    projectRelativePath = normalizeMediaCachePath(projectRelativePath);

    // Wait if currently generating (e.g. cancellation still in progress)
    if (params.generatingProxies.value.has(projectRelativePath)) return;

    const proxiesVfsPath = params.getProjectProxiesVfsPath();
    if (!proxiesVfsPath) throw new Error('Could not resolve proxies directory');

    // Ensure proxies directory exists via VFS
    const vfs = params.getVfs();
    await vfs.createDirectory(proxiesVfsPath);

    params.generatingProxies.value = new Set([
      ...params.generatingProxies.value,
      projectRelativePath,
    ]);
    params.proxyProgress.value = new Map(params.proxyProgress.value).set(projectRelativePath, 0);

    const controller = new AbortController();
    let bgTaskId: string | null = null;

    if (!options?.suppressBgTask) {
      bgTaskId = params.backgroundTasksStore.addTask({
        type: 'proxy',
        title: params.getProxyTaskTitle({
          fileName: projectRelativePath.split('/').pop() ?? projectRelativePath,
          projectRelativePath,
        }),
        status: 'pending',
        cancel: async () => {
          await cancelProxyGeneration(projectRelativePath);
        },
      });
      params.bgTaskIdsByPath.value = new Map(params.bgTaskIdsByPath.value).set(
        projectRelativePath,
        bgTaskId,
      );
    }

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

    const proxyFilename = await params.getProxyFileName(projectRelativePath);
    const proxyVfsPath = `${proxiesVfsPath}/${proxyFilename}`;

    try {
      await params.proxyQueue.value.add(
        async () => {
          try {
            if (controller.signal.aborted) {
              const abortErr = new Error('Proxy generation cancelled');
              (abortErr as Error).name = 'AbortError';
              throw abortErr;
            }

            if (bgTaskId) {
              params.backgroundTasksStore.updateTaskStatus(bgTaskId, 'running');
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

            // Worker needs a FileSystemFileHandle for createWritable().
            // Ensure the file exists via VFS, then obtain a raw handle through
            // the platform-specific bridge. This is the single remaining
            // handle-crossing point — worker exports write to it directly via
            // the FileSystemWritableFileStream API.
            await vfs.writeFile(proxyVfsPath, new Uint8Array(0));
            const proxyFileHandle = await params.getWriteFileHandle(proxyVfsPath);
            if (!proxyFileHandle) throw new Error('Could not obtain proxy file handle');

            const optimization = params.getOptimizationSettings();

            if (isTauriRuntime()) {
              const sourceHandle = await params.getFileHandleByPath(projectRelativePath);
              const sourcePath = getNativeFileHandlePath(sourceHandle);
              const targetPath = getNativeFileHandlePath(proxyFileHandle);
              if (!sourcePath || !targetPath) {
                throw new Error('Could not resolve native file paths for proxy generation');
              }
              const meta = await nativeMediaMetadata(sourcePath);
              const durationUs = Math.round((meta.duration || 0) * 1_000_000);
              if (!durationUs) throw new Error('Invalid video duration');
              await nativeGenerateProxy({
                taskId,
                sourcePath,
                targetPath,
                options: {
                  maxPixels: optimization.proxyMaxPixels,
                  videoBitrateBps: optimization.proxyVideoBitrateMbps * 1_000_000,
                  audioBitrateBps: optimization.proxyAudioBitrateKbps * 1000,
                  videoCodec: 'h264',
                  copyOpusAudio: optimization.proxyCopyOpusAudio,
                },
                onProgress: (progress) => {
                  const nextProgress = new Map(params.proxyProgress.value);
                  nextProgress.set(projectRelativePath, progress * 100);
                  params.proxyProgress.value = nextProgress;
                  const bgTaskId = params.bgTaskIdsByPath.value.get(projectRelativePath);
                  if (bgTaskId) {
                    params.backgroundTasksStore.updateTaskProgress(bgTaskId, progress);
                  }
                },
              });
              params.existingProxies.value = new Set([
                ...params.existingProxies.value,
                projectRelativePath,
              ]);
              if (bgTaskId) {
                params.backgroundTasksStore.updateTaskStatus(bgTaskId, 'completed');
              }
              return;
            }

            const { client } = getProxyWorkerClient();

            const meta = await client.extractMetadata(file);
            const sourceWidth = meta.video?.width || 1920;
            const sourceHeight = meta.video?.height || 1080;

            const sourcePixels = sourceWidth * sourceHeight;
            const targetPixels = optimization.proxyMaxPixels;

            let scale = 1.0;
            if (sourcePixels > targetPixels) {
              scale = Math.sqrt(targetPixels / sourcePixels);
              const commonScales = [0.5, 0.25, 0.125, 0.0625];
              for (const s of commonScales) {
                if (s >= scale * 0.8 && s <= scale * 1.2) {
                  scale = s;
                  break;
                }
              }
            }

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
            ] as unknown[];

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
                ] as unknown[])
              : [];

            const isOpusAudio =
              typeof meta.audio?.codec === 'string' &&
              meta.audio.codec.toLowerCase().startsWith('opus');

            const exportOptions = {
              format: 'mp4' as const,
              videoCodec: 'avc1.64001f',
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
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              videoClips as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              audioClips as any,
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
            // Clean up the partially-written proxy file
            try {
              await vfs.deleteEntry(proxyVfsPath);
            } catch {
              // Best-effort cleanup
            }
            const nextStatus = (innerErr as Error)?.name === 'AbortError' ? 'cancelled' : 'failed';
            if (bgTaskId) {
              params.backgroundTasksStore.updateTaskStatus(bgTaskId, nextStatus, String(innerErr));
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

            const nextBgTaskIds = new Map(params.bgTaskIdsByPath.value);
            nextBgTaskIds.delete(projectRelativePath);
            params.bgTaskIdsByPath.value = nextBgTaskIds;
          }
        },
        { priority: MEDIA_TASK_PRIORITIES.proxy, signal: controller.signal },
      );
    } catch (e) {
      const isAbort = (e as Error)?.name === 'AbortError';

      // The inner catch already wrote a terminal status; calling updateTaskStatus
      // here is a no-op because the store guards terminal transitions, but we
      // still attempt it for tasks that never entered the queue body.
      if (bgTaskId) {
        params.backgroundTasksStore.updateTaskStatus(
          bgTaskId,
          isAbort ? 'cancelled' : 'failed',
          String(e),
        );
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

      const nextBgTaskIds = new Map(params.bgTaskIdsByPath.value);
      nextBgTaskIds.delete(projectRelativePath);
      params.bgTaskIdsByPath.value = nextBgTaskIds;

      if (isAbort) {
        return;
      }
      throw e;
    }
  }

  async function cancelProxyGeneration(projectRelativePath: string) {
    projectRelativePath = normalizeMediaCachePath(projectRelativePath);
    const controller = params.proxyAbortControllers.value.get(projectRelativePath);
    if (controller && !controller.signal.aborted) {
      controller.abort();
      // The catch branch in the queue body will set the terminal status; we do
      // not write it here to avoid double updates and overwriting error info.
    }

    const taskId = params.proxyTaskIds.value.get(projectRelativePath);
    if (taskId && params.activeWorkerPaths.value.has(projectRelativePath)) {
      try {
        if (isTauriRuntime()) {
          await nativeCancelMediaTask(taskId);
        } else {
          const { client } = getProxyWorkerClient();
          await client.cancelExport(taskId);
        }
      } catch {
        // ignore
      }
    }
  }

  async function generateProxiesBatch(
    entries: { file: File | FileSystemFileHandle; projectRelativePath: string }[],
    options?: { signal?: AbortSignal },
  ): Promise<{ skippedCount: number }> {
    if (entries.length === 0) return { skippedCount: 0 };

    entries = entries.map((entry) => ({
      ...entry,
      projectRelativePath: normalizeMediaCachePath(entry.projectRelativePath),
    }));

    const needsProxy = entries.filter(
      (e) => !params.existingProxies.value.has(e.projectRelativePath),
    );
    const skippedCount = entries.length - needsProxy.length;

    if (needsProxy.length === 0) {
      return { skippedCount };
    }

    if (needsProxy.length === 1) {
      const first = needsProxy[0]!;
      await generateProxy(first.file, first.projectRelativePath, options);
      return { skippedCount };
    }

    const batchBgTaskId = params.backgroundTasksStore.addTask({
      type: 'proxy',
      title: params.getProxyTaskTitle({
        fileName: `${needsProxy.length}`,
        projectRelativePath: '',
      }),
      status: 'pending',
      cancel: async () => {
        for (const { projectRelativePath } of needsProxy) {
          await cancelProxyGeneration(projectRelativePath);
        }
      },
    });
    params.backgroundTasksStore.updateTaskStatus(batchBgTaskId, 'running');

    let completedCount = 0;
    let failedCount = 0;

    for (const { file, projectRelativePath } of needsProxy) {
      try {
        await generateProxy(file, projectRelativePath, {
          signal: options?.signal,
          suppressBgTask: true,
        });
        completedCount++;
      } catch (err) {
        failedCount++;
        log.warn('Failed to generate proxy in batch', projectRelativePath, err);
      }
      params.backgroundTasksStore.updateTaskProgress(
        batchBgTaskId,
        (completedCount + failedCount) / needsProxy.length,
      );
    }

    const skippedMessage =
      skippedCount > 0 ? `${skippedCount} file(s) already have a proxy and were skipped.` : '';

    if (failedCount === needsProxy.length) {
      params.backgroundTasksStore.updateTaskStatus(
        batchBgTaskId,
        'failed',
        skippedMessage || 'All proxy generations failed',
      );
    } else if (failedCount > 0) {
      params.backgroundTasksStore.updateTaskStatus(
        batchBgTaskId,
        'completed',
        `${failedCount} of ${needsProxy.length} failed. ${skippedMessage}`.trim(),
      );
    } else if (skippedMessage) {
      params.backgroundTasksStore.updateTaskStatus(batchBgTaskId, 'completed', skippedMessage);
    } else {
      params.backgroundTasksStore.updateTaskStatus(batchBgTaskId, 'completed');
    }

    return { skippedCount };
  }

  async function deleteProxiesBatch(projectRelativePaths: string[]): Promise<void> {
    projectRelativePaths = projectRelativePaths.map((path) => normalizeMediaCachePath(path));
    if (projectRelativePaths.length === 0) return;
    if (projectRelativePaths.length === 1) {
      await deleteProxy(projectRelativePaths[0]!);
      return;
    }

    const batchBgTaskId = params.backgroundTasksStore.addTask({
      type: 'proxy',
      title: params.getProxyTaskTitle({
        fileName: `${projectRelativePaths.length}`,
        projectRelativePath: '',
      }),
      status: 'pending',
    });
    params.backgroundTasksStore.updateTaskStatus(batchBgTaskId, 'running');

    for (let i = 0; i < projectRelativePaths.length; i++) {
      await deleteProxy(projectRelativePaths[i]!);
      params.backgroundTasksStore.updateTaskProgress(
        batchBgTaskId,
        (i + 1) / projectRelativePaths.length,
      );
    }

    params.backgroundTasksStore.updateTaskStatus(batchBgTaskId, 'completed');
  }

  async function deleteProxy(projectRelativePath: string) {
    projectRelativePath = normalizeMediaCachePath(projectRelativePath);
    const vfs = params.getVfs();
    try {
      const proxyFilePath = await params.getProxyFilePath(projectRelativePath);
      if (proxyFilePath) {
        await vfs.deleteEntry(proxyFilePath);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'NotFoundError') {
        log.warn('Failed to delete proxy', e);
        return;
      }
    }

    const next = new Set(params.existingProxies.value);
    next.delete(projectRelativePath);
    params.existingProxies.value = next;
  }

  async function renameProxyDir(input: { oldPath: string; newPath: string }) {
    input = {
      oldPath: normalizeMediaCachePath(input.oldPath),
      newPath: normalizeMediaCachePath(input.newPath),
    };
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
    input = {
      oldPath: normalizeMediaCachePath(input.oldPath),
      newPath: normalizeMediaCachePath(input.newPath),
    };
    const vfs = params.getVfs();

    try {
      const oldProxyPath = await params.getProxyFilePath(input.oldPath);
      const newProxyPath = await params.getProxyFilePath(input.newPath);
      if (!oldProxyPath || !newProxyPath) return;

      // Try VFS move first; fall back to copy+delete if not supported
      try {
        await vfs.moveEntry(oldProxyPath, newProxyPath);
      } catch {
        await vfs.copyFile(oldProxyPath, newProxyPath);
        await vfs.deleteEntry(oldProxyPath);
      }

      const next = new Set(params.existingProxies.value);
      next.delete(input.oldPath);
      if (input.newPath.startsWith(`${VIDEO_DIR_NAME}/`)) {
        next.add(input.newPath);
      }
      params.existingProxies.value = next;
    } catch (e) {
      log.warn('Failed to rename proxy', e);
      // Clean up if rename failed
      const next = new Set(params.existingProxies.value);
      next.delete(input.oldPath);
      params.existingProxies.value = next;
    }
  }

  /**
   * Returns a platform FileSystemFileHandle for the proxy file.
   *
   * **Tier-3 limitation**: VFS doesn't expose platform handles, so this
   * always returns `null`. The monitor composables fall back to
   * `getProxyFile()` (File-based) which works through VFS. This stub will
   * be replaced when the worker RPC layer migrates to VFS-native streaming.
   */
  async function getProxyFileHandle(
    _projectRelativePath: string,
  ): Promise<FileSystemFileHandle | null> {
    // VFS abstraction cannot produce raw FileSystemFileHandle.
    // Monitor composables have a getProxyFile fallback path.
    return null;
  }

  async function getProxyFile(projectRelativePath: string): Promise<File | null> {
    projectRelativePath = normalizeMediaCachePath(projectRelativePath);
    const proxyFilePath = await params.getProxyFilePath(projectRelativePath);
    if (!proxyFilePath) return null;

    try {
      const vfs = params.getVfs();
      return await vfs.getFile(proxyFilePath);
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
    generateProxiesBatch,
    deleteProxiesBatch,
  };
}
