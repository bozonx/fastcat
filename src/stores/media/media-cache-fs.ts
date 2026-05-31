import {
  FILES_META_ROOT_DIR_NAME,
  WAVEFORMS_ROOT_DIR_NAME,
} from '~/utils/storage-roots';
import { toProjectTempVfsPath } from '~/utils/storage-topology';

/**
 * Builds VFS addresses for the per-project media cache (file metadata +
 * waveform peaks). The actual IO is done by the caller through the VFS so that
 * atomic writes and the I/O governor apply uniformly; this module only owns the
 * path layout, which mirrors the on-disk structure under the resolved temp root
 * (`@ptemp/projects/<projectId>/{files-meta,waveforms}/<cacheFileName>`).
 */
export interface MediaCacheFsModule {
  getCacheFileName: (projectRelativePath: string) => string;
  /** `@ptemp` path to the file-metadata JSON, or null when no project is open. */
  getFilesMetaFilePath: (projectRelativePath: string) => string | null;
  /** `@ptemp` path to the waveform-peaks blob, or null when no project is open. */
  getWaveformsFilePath: (projectRelativePath: string) => string | null;
}

export function createMediaCacheFsModule(deps: {
  getProjectId: () => string | null;
}): MediaCacheFsModule {
  function getCacheFileName(projectRelativePath: string): string {
    return `${encodeURIComponent(projectRelativePath)}.json`;
  }

  function buildCacheFilePath(leaf: string, projectRelativePath: string): string | null {
    const projectId = deps.getProjectId();
    if (!projectId) return null;
    const dir = toProjectTempVfsPath(projectId, [leaf]);
    return `${dir}/${getCacheFileName(projectRelativePath)}`;
  }

  function getFilesMetaFilePath(projectRelativePath: string): string | null {
    return buildCacheFilePath(FILES_META_ROOT_DIR_NAME, projectRelativePath);
  }

  function getWaveformsFilePath(projectRelativePath: string): string | null {
    return buildCacheFilePath(WAVEFORMS_ROOT_DIR_NAME, projectRelativePath);
  }

  return {
    getCacheFileName,
    getFilesMetaFilePath,
    getWaveformsFilePath,
  } satisfies MediaCacheFsModule;
}
