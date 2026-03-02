import { defineStore } from 'pinia';
import { ref } from 'vue';

import { useWorkspaceStore } from './workspace.store';
import { useProjectStore } from './project.store';

import { createMediaCacheFsModule } from '~/stores/media/mediaCacheFs';
import { createMediaWorkerModule } from '~/stores/media/mediaWorker';

interface VideoColorSpaceInit {
  fullRange?: boolean;
  matrix?: string;
  primaries?: string;
  transfer?: string;
}

export interface MediaMetadata {
  source: {
    size: number;
    lastModified: number;
  };
  mimeType?: string;
  container?: string;
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
    bitrate?: number;
    colorSpace?: VideoColorSpaceInit;
  };
  audio?: {
    codec: string;
    parsedCodec: string;
    sampleRate: number;
    channels: number;
    bitrate?: number;
  };
  audioPeaks?: number[][];
}

export const useMediaStore = defineStore('media', () => {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();

  const fsModule = createMediaCacheFsModule({
    getWorkspaceHandle: () => workspaceStore.workspaceHandle,
    getProjectId: () => projectStore.currentProjectId,
  });

  const workerModule = createMediaWorkerModule();

  const mediaMetadata = ref<Record<string, MediaMetadata>>({});

  function resetMediaState() {
    mediaMetadata.value = {};
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

    const fileType = typeof file.type === 'string' ? file.type : '';
    const isKnownMediaByMime =
      fileType.startsWith('video/') ||
      fileType.startsWith('audio/') ||
      fileType.startsWith('image/');
    const isKnownMediaByExt = (() => {
      const ext = projectRelativePath.split('.').pop()?.toLowerCase() ?? '';
      if (!ext) return false;
      return [
        // Video
        'mp4',
        'mov',
        'mkv',
        'webm',
        'm4v',
        'avi',
        // Audio
        'mp3',
        'wav',
        'ogg',
        'm4a',
        'aac',
        'flac',
        // Images
        'png',
        'jpg',
        'jpeg',
        'webp',
        'bmp',
        'gif',
        'tiff',
        'tif',
      ].includes(ext);
    })();

    if (!isKnownMediaByMime && !isKnownMediaByExt) return null;

    if (!options?.forceRefresh && mediaMetadata.value[cacheKey]) {
      const cached = mediaMetadata.value[cacheKey]!;
      if (cached.source.size === file.size && cached.source.lastModified === file.lastModified) {
        return cached;
      }
    }

    const metaDir = await fsModule.ensureFilesMetaDir();
    const cacheFileName = fsModule.getCacheFileName(projectRelativePath);

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
      const meta = (await workerModule.extractMetadata(fileHandle)) as MediaMetadata | null;

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

  function setAudioPeaks(projectRelativePath: string, peaks: number[][]) {
    if (mediaMetadata.value[projectRelativePath]) {
      mediaMetadata.value[projectRelativePath].audioPeaks = peaks;
    }
  }

  return {
    mediaMetadata,
    getOrFetchMetadataByPath,
    getOrFetchMetadata,
    resetMediaState,
    setAudioPeaks,
  };
});
