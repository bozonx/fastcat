export interface ProxyThumbnailServiceDeps {
  checkExistingProxies: (paths: string[]) => Promise<void>;
  hasProxy: (path: string) => boolean;
  ensureProxy: (params: {
    file: File | FileSystemFileHandle;
    projectRelativePath: string;
  }) => Promise<void>;
  cancelProxy: (projectRelativePath: string) => Promise<void>;
  removeProxy: (projectRelativePath: string) => Promise<void>;
  clearExistingProxies: () => void;
  clearVideoThumbnails: (params: {
    projectId: string;
    projectRelativePath: string;
  }) => Promise<void>;
  clearWaveforms: (params: { projectId: string; projectRelativePath: string }) => Promise<void>;
}

export interface ProxyThumbnailService {
  checkExistingProxies: (paths: string[]) => Promise<void>;
  hasProxy: (path: string) => boolean;
  ensureProxy: (params: {
    file: File | FileSystemFileHandle;
    projectRelativePath: string;
  }) => Promise<void>;
  cancelProxy: (projectRelativePath: string) => Promise<void>;
  removeProxy: (projectRelativePath: string) => Promise<void>;
  clearExistingProxies: () => void;
  clearVideoThumbnails: (params: {
    projectId: string;
    projectRelativePath: string;
  }) => Promise<void>;
  clearWaveforms: (params: { projectId: string; projectRelativePath: string }) => Promise<void>;
}

export function createProxyThumbnailService(
  deps: ProxyThumbnailServiceDeps,
): ProxyThumbnailService {
  return {
    checkExistingProxies: (paths) => deps.checkExistingProxies(paths),
    hasProxy: (path) => deps.hasProxy(path),
    ensureProxy: (params) =>
      deps.ensureProxy({
        file: params.file,
        projectRelativePath: params.projectRelativePath,
      }),
    cancelProxy: (projectRelativePath) => deps.cancelProxy(projectRelativePath),
    removeProxy: (projectRelativePath) => deps.removeProxy(projectRelativePath),
    clearExistingProxies: () => deps.clearExistingProxies(),
    clearVideoThumbnails: (params) =>
      deps.clearVideoThumbnails({
        projectId: params.projectId,
        projectRelativePath: params.projectRelativePath,
      }),
    clearWaveforms: (params) =>
      deps.clearWaveforms({
        projectId: params.projectId,
        projectRelativePath: params.projectRelativePath,
      }),
  };
}
