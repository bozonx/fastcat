import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { createProxyFsModule } from '~/stores/proxy/proxyFs';
import { createProxyQueueModule } from '~/stores/proxy/proxyQueue';
import { createProxyService } from '~/stores/proxy/proxyService';

export const useProxyStore = defineStore('proxy', () => {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();

  const videoExtensions = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm']);

  const generatingProxies = ref<Set<string>>(new Set());
  const existingProxies = ref<Set<string>>(new Set());
  const proxyProgress = ref<Map<string, number>>(new Map());
  const proxyAbortControllers = ref<Map<string, AbortController>>(new Map());
  // Tracks paths currently executing in worker (not just queued)
  const activeWorkerPaths = ref<Set<string>>(new Set());
  const proxyTaskIds = ref<Map<string, string>>(new Map());
  const taskIdToPath = ref<Map<string, string>>(new Map());

  const fsModule = createProxyFsModule({
    workspaceHandle: computed(() => workspaceStore.workspaceHandle),
    currentProjectId: computed(() => projectStore.currentProjectId),
    resolvedStorageTopology: computed(() => workspaceStore.resolvedStorageTopology),
  });

  const queueModule = createProxyQueueModule({
    concurrency: computed(() => workspaceStore.userSettings.optimization.mediaTaskConcurrency),
  });

  const service = createProxyService({
    videoExtensions,
    generatingProxies,
    existingProxies,
    proxyProgress,
    proxyAbortControllers,
    activeWorkerPaths,
    proxyTaskIds,
    taskIdToPath,
    proxyQueue: queueModule.proxyQueue,
    ensureProjectProxiesDir: fsModule.ensureProjectProxiesDir,
    getProxyFileName: fsModule.getProxyFileName,
    getFileHandleByPath: async (path) => await projectStore.getFileHandleByPath(path),
    getFileByPath: async (path) => await projectStore.getFileByPath(path),
    getOptimizationSettings: () => workspaceStore.userSettings.optimization,
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
    cancelProxyGeneration: service.cancelProxyGeneration,
    deleteProxy: service.deleteProxy,
    renameProxy: service.renameProxy,
    renameProxyDir: service.renameProxyDir,
    getProxyFileHandle: service.getProxyFileHandle,
    getProxyFile: service.getProxyFile,
  };
});
