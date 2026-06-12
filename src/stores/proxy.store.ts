import { ref } from 'vue';
import { defineStore } from 'pinia';
import { useNuxtApp } from 'nuxt/app';
import type { I18nService } from '~/services/i18n.service';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { createProxyFsModule } from '~/stores/proxy/proxyFs';
import { createProxyQueueModule } from '~/stores/proxy/proxyQueue';
import { createProxyService } from '~/stores/proxy/proxyService';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useVfs } from '~/composables/useVfs';
import { ensureResolvedProjectProxiesDir } from '~/utils/storage-handles';
import { isTauriRuntime } from '~/utils/runtime';
import { getNativeFileHandlePath } from '~/utils/tauri-media-processing';

export const useProxyStore = defineStore('proxy', () => {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const backgroundTasksStore = useBackgroundTasksStore();
  const nuxtApp = useNuxtApp();

  const videoExtensions = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm']);

  const generatingProxies = ref<Set<string>>(new Set());
  const existingProxies = ref<Set<string>>(new Set());
  const proxyProgress = ref<Map<string, number>>(new Map());
  const proxyAbortControllers = ref<Map<string, AbortController>>(new Map());
  // Tracks paths currently executing in worker (not just queued)
  const activeWorkerPaths = ref<Set<string>>(new Set());
  const proxyTaskIds = ref<Map<string, string>>(new Map());
  const taskIdToPath = ref<Map<string, string>>(new Map());
  const bgTaskIdsByPath = ref<Map<string, string>>(new Map());

  const fsModule = createProxyFsModule({
    getProjectId: () => projectStore.currentProjectId,
    getResolvedStorageTopology: () => workspaceStore.resolvedStorageTopology,
  });

  // Lazy: the VFS plugin initializes after stores are set up.
  const getVfs = () => useVfs();

  const queueModule = createProxyQueueModule();

  /**
   * Tier-3 bridge: obtain a raw FileSystemFileHandle at a VFS path.
   * The WebCodecs worker needs `createWritable()` for streaming writes.
   * Uses the legacy handle-based path through `ensureResolvedProjectProxiesDir`
   * + OPFS handle navigation. This will be removed when the worker RPC layer
   * migrates to VFS-native streaming.
   */
  async function getWriteFileHandle(proxyVfsPath: string): Promise<FileSystemFileHandle | null> {
    const wsHandle = workspaceStore.workspaceHandle;
    const projectId = projectStore.currentProjectId;
    if (!wsHandle || !projectId) return null;

    try {
      const proxiesDir = (await ensureResolvedProjectProxiesDir({
        workspaceHandle: wsHandle,
        topology: workspaceStore.resolvedStorageTopology,
        projectId,
        create: true,
      })) as FileSystemDirectoryHandle;

      // Extract filename from the full VFS path
      const fileName = proxyVfsPath.split('/').pop();
      if (!fileName) return null;

      return await proxiesDir.getFileHandle(fileName, { create: true });
    } catch {
      return null;
    }
  }

  /**
   * Resolve the absolute on-disk path of a clip's proxy for the native (Tauri)
   * monitor/exporter. Returns null on web (no native paths) or when no proxy
   * exists for the source. The native monitor decodes by absolute path, so it
   * cannot go through the VFS `getProxyFile()` File-stream path the web monitor
   * uses — it needs the real filesystem path of the proxy mp4.
   */
  async function getProxyNativePath(projectRelativePath: string): Promise<string | null> {
    if (!isTauriRuntime()) return null;
    if (!existingProxies.value.has(projectRelativePath)) return null;
    const proxyVfsPath = await fsModule.getProxyFilePath(projectRelativePath);
    if (!proxyVfsPath) return null;
    const handle = await getWriteFileHandle(proxyVfsPath);
    if (!handle) return null;
    return getNativeFileHandlePath(handle);
  }

  const service = createProxyService({
    videoExtensions,
    generatingProxies,
    existingProxies,
    proxyProgress,
    proxyAbortControllers,
    activeWorkerPaths,
    proxyTaskIds,
    taskIdToPath,
    bgTaskIdsByPath,
    proxyQueue: queueModule.proxyQueue,
    getProjectProxiesVfsPath: fsModule.getProjectProxiesVfsPath,
    getProxyFileName: fsModule.getProxyFileName,
    getProxyFilePath: fsModule.getProxyFilePath,
    getVfs,
    getWriteFileHandle,
    getFileHandleByPath: async (path) => await projectStore.getFileHandleByPath(path),
    getFileByPath: async (path) => await projectStore.getFileByPath(path),
    getOptimizationSettings: () => workspaceStore.userSettings.optimization,
    getProxyTaskTitle: ({ fileName }) =>
      (nuxtApp.$i18nService as I18nService).t('videoEditor.backgroundTasks.proxyTitle', {
        fileName,
      }),
    backgroundTasksStore,
  });

  return {
    generatingProxies,
    existingProxies,
    proxyProgress,
    proxyAbortControllers,
    activeWorkerPaths,
    checkExistingProxies: service.checkExistingProxies,
    generateProxy: service.generateProxy,
    generateProxiesForFolder: service.generateProxiesForFolder,
    generateProxiesBatch: service.generateProxiesBatch,
    cancelProxyGeneration: service.cancelProxyGeneration,
    deleteProxy: service.deleteProxy,
    deleteProxiesBatch: service.deleteProxiesBatch,
    renameProxy: service.renameProxy,
    renameProxyDir: service.renameProxyDir,
    getProxyFileHandle: service.getProxyFileHandle,
    getProxyFile: service.getProxyFile,
    getProxyNativePath,
  };
});
