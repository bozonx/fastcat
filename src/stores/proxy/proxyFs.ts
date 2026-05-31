import type { ResolvedStorageTopology } from '~/utils/storage-topology';
import { toProjectProxiesVfsPath } from '~/utils/storage-topology';

/**
 * Builds VFS addresses for the per-project proxy video files.
 *
 * Most proxy operations (check, delete, rename, getFile) go through VFS.
 * The two exceptions that still need raw `FileSystemFileHandle` are:
 * - `generateProxy` — WebCodecs worker writes to a handle via `createWritable()`
 * - `getProxyFileHandle` — monitor composables need a handle for WebCodecs playback
 *
 * For those, callers must obtain the handle through platform-specific means
 * (e.g. `projectStore.getFileHandleByPath`). This module only builds the
 * VFS path that maps to the same on-disk location.
 */
export interface ProxyFsModule {
  getProxyFileName: (projectRelativePath: string) => Promise<string>;
  /** VFS path to the project proxies directory, or null when no project is open. */
  getProjectProxiesVfsPath: () => string | null;
  /** Full VFS path to a specific proxy file, or null when no project is open. */
  getProxyFilePath: (projectRelativePath: string) => Promise<string | null>;
}

export function createProxyFsModule(params: {
  getProjectId: () => string | null;
  getResolvedStorageTopology: () => ResolvedStorageTopology;
}): ProxyFsModule {
  async function hashString(str: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function getProxyFileName(projectRelativePath: string): Promise<string> {
    const hash = await hashString(projectRelativePath);
    return `${hash}.mp4`;
  }

  function getProjectProxiesVfsPath(): string | null {
    const projectId = params.getProjectId();
    if (!projectId) return null;
    return toProjectProxiesVfsPath(params.getResolvedStorageTopology(), projectId);
  }

  async function getProxyFilePath(projectRelativePath: string): Promise<string | null> {
    const dirPath = getProjectProxiesVfsPath();
    if (!dirPath) return null;
    const fileName = await getProxyFileName(projectRelativePath);
    return `${dirPath}/${fileName}`;
  }

  return {
    getProxyFileName,
    getProjectProxiesVfsPath,
    getProxyFilePath,
  };
}
