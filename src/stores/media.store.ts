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
  const missingPaths = ref<Record<string, boolean>>({});

  function resetMediaState() {
    mediaMetadata.value = {};
    missingPaths.value = {};
  }

  async function getOrFetchMetadataByPath(path: string, options?: { forceRefresh?: boolean }) {
    const file = await projectStore.getFileByPath(path);
    if (!file) {
      missingPaths.value[path] = true;
      return null;
    }
    missingPaths.value[path] = false;
    return await getOrFetchMetadata(file, path, options);
  }

  async function getOrFetchMetadata(
    file: File,
    projectRelativePath: string,
    options?: { forceRefresh?: boolean },
  ): Promise<MediaMetadata | null> {
    const cacheKey = projectRelativePath;

    // Clear missing status if we are here (we have a file handle)
    missingPaths.value[projectRelativePath] = false;

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

    let parsedMeta: MediaMetadata | null = null;

    if (!options?.forceRefresh && metaDir) {
      try {
        const cacheHandle = await metaDir.getFileHandle(cacheFileName);
        const cacheFile = await cacheHandle.getFile();
        const text = await cacheFile.text();
        const parsed = JSON.parse(text) as MediaMetadata;
        if (parsed.source.size === file.size && parsed.source.lastModified === file.lastModified) {
          parsedMeta = parsed;
        }
      } catch {
        // Cache miss
      }
    }

    if (parsedMeta) {
      // Try to load cached peaks
      const waveformsDir = await fsModule.ensureWaveformsDir();
      if (waveformsDir) {
        try {
          const peaksHandle = await waveformsDir.getFileHandle(cacheFileName);
          const peaksFile = await peaksHandle.getFile();
          const peaksText = await peaksFile.text();
          const peaksData = JSON.parse(peaksText) as number[][];
          parsedMeta.audioPeaks = peaksData;
        } catch {
          // No cached peaks
        }
      }

      mediaMetadata.value[cacheKey] = parsedMeta;
      return parsedMeta;
    }

    try {
      const meta = (await workerModule.extractMetadata(file)) as MediaMetadata | null;

      if (meta) {
        mediaMetadata.value[cacheKey] = meta;

        if (metaDir) {
          const cacheHandle = await metaDir.getFileHandle(cacheFileName, { create: true });
          const writable = await (cacheHandle as any).createWritable();
          // We don't want to save large peaks array inside main metadata json
          const metaToSave = { ...meta };
          delete metaToSave.audioPeaks;

          await writable.write(JSON.stringify(metaToSave, null, 2));
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

      // Save peaks to OPFS
      const cacheFileName = fsModule.getCacheFileName(projectRelativePath);
      fsModule
        .ensureWaveformsDir()
        .then((waveformsDir) => {
          if (!waveformsDir) return;
          waveformsDir
            .getFileHandle(cacheFileName, { create: true })
            .then((peaksHandle) => {
              (peaksHandle as any)
                .createWritable()
                .then((writable: any) => {
                  writable.write(JSON.stringify(peaks)).then(() => writable.close());
                })
                .catch((e: Error) => console.warn('Failed to write peaks', e));
            })
            .catch((e) => console.warn('Failed to get peaks handle', e));
        })
        .catch((e) => console.warn('Failed to get waveforms dir', e));
    }
  }

  async function revalidateMissingMedia(usedPaths: string[]) {
    const results = await Promise.all(
      usedPaths.map(async (path) => {
        const file = await projectStore.getFileByPath(path);
        return { path, exists: Boolean(file) };
      }),
    );

    for (const { path, exists } of results) {
      missingPaths.value[path] = !exists;
    }
  }

  async function removeMediaCache(projectRelativePath: string) {
    delete mediaMetadata.value[projectRelativePath];
    delete missingPaths.value[projectRelativePath];
    await fsModule.removeCacheFiles(projectRelativePath);
  }

  return {
    mediaMetadata,
    missingPaths,
    getOrFetchMetadataByPath,
    getOrFetchMetadata,
    resetMediaState,
    setAudioPeaks,
    revalidateMissingMedia,
    removeMediaCache,
  };
});
