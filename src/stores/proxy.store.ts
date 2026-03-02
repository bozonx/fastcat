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
    workspaceHandle: computed(() => workspaceStore.workspaceHandle) as any,
    currentProjectId: computed(() => projectStore.currentProjectId) as any,
  });

  const queueModule = createProxyQueueModule({
    concurrency: ref(workspaceStore.userSettings.optimization.proxyConcurrency) as any,
  });

  const service = createProxyService({
    videoExtensions,
    generatingProxies,
    existingProxies,
    proxyProgress,
    proxyAbortControllers,
    activeWorkerPaths,
    proxyQueue: queueModule.proxyQueue as any,
    ensureProjectProxiesDir: fsModule.ensureProjectProxiesDir,
    getProxyFileName: fsModule.getProxyFileName,
    getFileHandleByPath: async (path) => await projectStore.getFileHandleByPath(path),
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
    getProxyFileHandle: service.getProxyFileHandle,
    getProxyFile: service.getProxyFile,
  };
});
