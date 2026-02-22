import { defineStore } from 'pinia';
import { ref } from 'vue';

import { useWorkspaceStore } from './workspace.store';
import { useProjectStore } from './project.store';
import { getExportWorkerClient } from '../../utils/video-editor/worker-client';

export interface MediaMetadata {
  source: {
    size: number;
    lastModified: number;
  };
  duration: number;
  video?: {
    width: number;
    height: number;
    displayWidth: number;
    displayHeight: number;
    rotation: number;
    codec: string;
    parsedCodec: string;
    fps: number;
    colorSpace?: any;
  };
  audio?: {
    codec: string;
    parsedCodec: string;
    sampleRate: number;
    channels: number;
  };
}

export const useMediaStore = defineStore('media', () => {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();

  const mediaMetadata = ref<Record<string, MediaMetadata>>({});

  function getCacheFileName(projectRelativePath: string): string {
    return `${encodeURIComponent(projectRelativePath)}.json`;
  }

  async function ensureCacheDir(): Promise<FileSystemDirectoryHandle | null> {
    if (!workspaceStore.workspaceHandle || !projectStore.currentProjectName) return null;
    const cacheDir = await workspaceStore.workspaceHandle.getDirectoryHandle('cache', {
      create: true,
    });
    return await cacheDir.getDirectoryHandle(projectStore.currentProjectName, { create: true });
  }

  async function ensureFilesMetaDir(): Promise<FileSystemDirectoryHandle | null> {
    const projectCacheDir = await ensureCacheDir();
    if (!projectCacheDir) return null;
    return await projectCacheDir.getDirectoryHandle('files-meta', { create: true });
  }

  async function getOrFetchMetadataByPath(path: string, options?: { forceRefresh?: boolean }) {
    const handle = await projectStore.getFileHandleByPath(path);
    if (!handle) return null;
    return await getOrFetchMetadata(handle, path, options);
  }

  async function getOrFetchMetadata(
    fileHandle: FileSystemFileHandle,
    projectRelativePath: string,
    options?: { forceRefresh?: boolean },
  ): Promise<MediaMetadata | null> {
    const file = await fileHandle.getFile();
    const cacheKey = projectRelativePath;

    if (!options?.forceRefresh && mediaMetadata.value[cacheKey]) {
      const cached = mediaMetadata.value[cacheKey]!;
      if (cached.source.size === file.size && cached.source.lastModified === file.lastModified) {
        return cached;
      }
    }

    const metaDir = await ensureFilesMetaDir();
    const cacheFileName = getCacheFileName(projectRelativePath);

    if (!options?.forceRefresh && metaDir) {
      try {
        const cacheHandle = await metaDir.getFileHandle(cacheFileName);
        const cacheFile = await cacheHandle.getFile();
        const text = await cacheFile.text();
        const parsed = JSON.parse(text) as MediaMetadata;
        if (parsed.source.size === file.size && parsed.source.lastModified === file.lastModified) {
          mediaMetadata.value[cacheKey] = parsed;
          return parsed;
        }
      } catch {
        // Cache miss
      }
    }

    try {
      const { client } = getExportWorkerClient();
      const meta = await client.extractMetadata(fileHandle);

      if (meta) {
        mediaMetadata.value[cacheKey] = meta;

        if (metaDir) {
          const cacheHandle = await metaDir.getFileHandle(cacheFileName, { create: true });
          const writable = await (cacheHandle as any).createWritable();
          await writable.write(JSON.stringify(meta, null, 2));
          await writable.close();
        }

        return meta;
      }
      return null;
    } catch (e) {
      console.error('Failed to fetch metadata for', projectRelativePath, e);
      return null;
    }
  }

  return {
    mediaMetadata,
    getOrFetchMetadataByPath,
    getOrFetchMetadata,
  };
});
