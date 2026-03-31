import { defineStore } from 'pinia';
import { ref } from 'vue';

import { useWorkspaceStore } from './workspace.store';
import { useProjectStore } from './project.store';

import { createMediaCacheFsModule } from '~/stores/media/media-cache-fs';
import { createMediaWorkerModule } from '~/stores/media/media-worker';
import { getMediaTypeFromFilename } from '~/utils/media-types';

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
    canDecode?: boolean;
  };
  audio?: {
    codec: string;
    parsedCodec: string;
    sampleRate: number;
    channels: number;
    bitrate?: number;
    canDecode?: boolean;
  };
  image?: {
    canDisplay?: boolean;
  };
  audioPeaks?: number[][];
}

export const useMediaStore = defineStore('media', () => {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();

  const fsModule = createMediaCacheFsModule({
    getWorkspaceHandle: () => workspaceStore.workspaceHandle,
    getProjectId: () => projectStore.currentProjectId,
    getResolvedStorageTopology: () => workspaceStore.resolvedStorageTopology,
  });

  const workerModule = createMediaWorkerModule();

  const mediaMetadata = ref<Record<string, MediaMetadata>>({});
  const missingPaths = ref<Record<string, boolean>>({});
  const metadataLoadFailed = ref<Record<string, boolean>>({});

  const pendingRequests = new Map<string, Promise<MediaMetadata | null>>();

  function resetMediaState() {
    mediaMetadata.value = {};
    missingPaths.value = {};
    metadataLoadFailed.value = {};
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

    const mediaType = getMediaTypeFromFilename(projectRelativePath);
    const isKnownMedia = mediaType === 'video' || mediaType === 'audio' || mediaType === 'image';

    if (!isKnownMedia) return null;

    if (!options?.forceRefresh) {
      if (mediaMetadata.value[cacheKey]) {
        const cached = mediaMetadata.value[cacheKey]!;
        if (cached.source.size === file.size && cached.source.lastModified === file.lastModified) {
          return cached;
        }
      }

      if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey)!;
      }
    }

    const requestPromise = (async () => {
      try {
        const result = await fetchMetadataInternal(file, projectRelativePath, options);
        return result;
      } finally {
        pendingRequests.delete(cacheKey);
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  async function fetchMetadataInternal(
    file: File,
    projectRelativePath: string,
    options?: { forceRefresh?: boolean },
  ): Promise<MediaMetadata | null> {
    const cacheKey = projectRelativePath;

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
          const mediaType = getMediaTypeFromFilename(projectRelativePath);
          const lacksVideoCompat =
            mediaType === 'video' &&
            parsed.video !== undefined &&
            parsed.video.canDecode === undefined;
          const lacksAudioCompat =
            (mediaType === 'video' || mediaType === 'audio') &&
            parsed.audio !== undefined &&
            parsed.audio.canDecode === undefined;
          const lacksImageCompat = mediaType === 'image' && parsed.image === undefined;

          if (!lacksVideoCompat && !lacksAudioCompat && !lacksImageCompat) {
            parsedMeta = parsed;
          }
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
      const meta = await workerModule.extractMetadata(file);

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
      console.warn('Failed to fetch metadata for', projectRelativePath, (e as Error)?.message);
      metadataLoadFailed.value[projectRelativePath] = true;
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
    delete metadataLoadFailed.value[projectRelativePath];
    await fsModule.removeCacheFiles(projectRelativePath);
  }

  return {
    mediaMetadata,
    missingPaths,
    metadataLoadFailed,
    getOrFetchMetadataByPath,
    getOrFetchMetadata,
    resetMediaState,
    setAudioPeaks,
    revalidateMissingMedia,
    removeMediaCache,
  };
});
