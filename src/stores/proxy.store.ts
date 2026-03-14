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
  const proxyProgress = ref<Record<string, number>>({});
  const proxyAbortControllers = ref<Record<string, AbortController>>({});
  // Tracks paths currently executing in worker (not just queued)
  const activeWorkerPaths = ref<Set<string>>(new Set());

  const fsModule = createProxyFsModule({
    workspaceHandle: computed(() => workspaceStore.workspaceHandle),
    currentProjectId: computed(() => projectStore.currentProjectId),
    resolvedStorageTopology: computed(() => workspaceStore.resolvedStorageTopology),
  });

  const queueModule = createProxyQueueModule({
    concurrency: computed(() => workspaceStore.userSettings.optimization.proxyConcurrency),
  });

  const service = createProxyService({
    videoExtensions,
    generatingProxies,
    existingProxies,
    proxyProgress,
    proxyAbortControllers,
    activeWorkerPaths,
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
    getProxyFileHandle: service.getProxyFileHandle,
    getProxyFile: service.getProxyFile,
  };
});
