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
    width?: number;
    height?: number;
  };
  /** Per-channel waveform peaks. Stored as Float32Array (4 B/sample) rather
   *  than `number[]` (~28 B/sample) so a 1-hour stereo source costs ~5.7 MB
   *  in RAM instead of ~40 MB. Persisted to OPFS as JSON `number[][]` for
   *  backward compatibility — convert at the boundary. */
  audioPeaks?: Float32Array[];
  error?: boolean;
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
  const metadataLoading = ref<Record<string, boolean>>({});

  const pendingRequests = new Map<string, Promise<MediaMetadata | null>>();
  const pendingPeakWrites = new Map<string, Promise<void>>();

  function resetMediaState() {
    mediaMetadata.value = {};
    missingPaths.value = {};
    metadataLoadFailed.value = {};
    metadataLoading.value = {};
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
          if (cached.error) {
            metadataLoadFailed.value[cacheKey] = true;
          }
          return cached;
        }
      }

      if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey)!;
      }
    } else {
      // If forceRefresh is true, we clear the failure state for this path
      Reflect.deleteProperty(metadataLoadFailed.value, cacheKey);
    }

    // For forceRefresh, chain after any in-flight non-force request so we don't
    // race with it on the same OPFS cache file, but ensure a fresh extraction.
    const previous = options?.forceRefresh ? pendingRequests.get(cacheKey) : undefined;

    metadataLoading.value[cacheKey] = true;

    let requestPromise!: Promise<MediaMetadata | null>;
    // eslint-disable-next-line prefer-const
    requestPromise = (async () => {
      try {
        if (previous) {
          await previous.catch(() => undefined);
        }
        const result = await fetchMetadataInternal(file, projectRelativePath, options);
        return result;
      } finally {
        if (pendingRequests.get(cacheKey) === requestPromise) {
          pendingRequests.delete(cacheKey);
        }
        Reflect.deleteProperty(metadataLoading.value, cacheKey);
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
            if (parsed.error) {
              metadataLoadFailed.value[cacheKey] = true;
            }
          }
        }
      } catch {
        // Cache miss
      }
    }

    if (parsedMeta) {
      // Try to load cached peaks
      if (!parsedMeta.error) {
        const waveformsDir = await fsModule.ensureWaveformsDir();
        if (waveformsDir) {
          try {
            const peaksHandle = await waveformsDir.getFileHandle(cacheFileName);
            const peaksFile = await peaksHandle.getFile();
            const peaksText = await peaksFile.text();
            const peaksData = JSON.parse(peaksText) as number[][];
            parsedMeta.audioPeaks = peaksData.map((channel) => new Float32Array(channel));
          } catch {
            // No cached peaks
          }
        }
      }

      mediaMetadata.value[cacheKey] = parsedMeta;
      return parsedMeta;
    }

    try {
      // Drop any stale peaks cache before regenerating metadata for a changed source.
      // Otherwise next session will load fresh metadata + outdated peaks together
      // and the waveform will mismatch the actual audio content.
      try {
        const waveformsDir = await fsModule.ensureWaveformsDir();
        if (waveformsDir) {
          await waveformsDir.removeEntry(cacheFileName).catch(() => {
            // No previous peaks file — ok
          });
        }
      } catch {
        // ignore
      }

      const meta = await workerModule.extractMetadata(file);

      if (meta) {
        mediaMetadata.value[cacheKey] = meta;

        if (metaDir) {
          const cacheHandle = await metaDir.getFileHandle(cacheFileName, { create: true });
          const writable = await (
            cacheHandle as { createWritable: () => Promise<FileSystemWritableFileStream> }
          ).createWritable();
          // We don't want to save large peaks array inside main metadata json
          const metaToSave = { ...meta };
          delete metaToSave.audioPeaks;

          await writable.write(JSON.stringify(metaToSave, null, 2));
          await writable.close();
        }

        return meta;
      }

      // If meta is null but worker didn't throw (e.g. unknown media)
      throw new Error('Worker returned null metadata');
    } catch (e) {
      console.warn('Failed to fetch metadata for', projectRelativePath, (e as Error)?.message);
      metadataLoadFailed.value[projectRelativePath] = true;

      // Persist failure state so we don't try again until file changes
      const errorMeta: MediaMetadata = {
        source: { size: file.size, lastModified: file.lastModified },
        duration: 0,
        error: true,
      };
      mediaMetadata.value[cacheKey] = errorMeta;

      if (metaDir) {
        try {
          const cacheHandle = await metaDir.getFileHandle(cacheFileName, { create: true });
          const writable = await (
            cacheHandle as { createWritable: () => Promise<FileSystemWritableFileStream> }
          ).createWritable();
          await writable.write(JSON.stringify(errorMeta, null, 2));
          await writable.close();
        } catch {
          // Ignore OPFS write error
        }
      }

      return null;
    }
  }

  function setAudioPeaks(projectRelativePath: string, peaks: Float32Array[]) {
    if (!mediaMetadata.value[projectRelativePath]) return;

    mediaMetadata.value[projectRelativePath].audioPeaks = peaks;

    // OPFS still stores peaks as JSON `number[][]` so old caches keep working.
    // Convert once here on the write side; reads convert back to Float32Array.
    const peaksAsJson = peaks.map((channel) => Array.from(channel));

    // Serialize peaks writes per-path to avoid concurrent createWritable() races on the
    // same OPFS entry which can yield truncated/interleaved JSON for long audio.
    const cacheFileName = fsModule.getCacheFileName(projectRelativePath);
    const previous = pendingPeakWrites.get(projectRelativePath) ?? Promise.resolve();
    const writeTask = previous
      .catch(() => {
        // ignore previous error — we still try to persist the latest peaks
      })
      .then(async () => {
        try {
          const waveformsDir = await fsModule.ensureWaveformsDir();
          if (!waveformsDir) return;
          const peaksHandle = await waveformsDir.getFileHandle(cacheFileName, { create: true });
          const writable = await (
            peaksHandle as { createWritable: () => Promise<FileSystemWritableFileStream> }
          ).createWritable();
          try {
            await writable.write(JSON.stringify(peaksAsJson));
          } finally {
            await writable.close();
          }
        } catch (e) {
          console.warn('Failed to write peaks', e);
        }
      })
      .finally(() => {
        if (pendingPeakWrites.get(projectRelativePath) === writeTask) {
          pendingPeakWrites.delete(projectRelativePath);
        }
      });

    pendingPeakWrites.set(projectRelativePath, writeTask);
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
    Reflect.deleteProperty(mediaMetadata.value, projectRelativePath);
    Reflect.deleteProperty(missingPaths.value, projectRelativePath);
    Reflect.deleteProperty(metadataLoadFailed.value, projectRelativePath);
    Reflect.deleteProperty(metadataLoading.value, projectRelativePath);
    await fsModule.removeCacheFiles(projectRelativePath);
  }

  return {
    mediaMetadata,
    missingPaths,
    metadataLoadFailed,
    metadataLoading,
    getOrFetchMetadataByPath,
    getOrFetchMetadata,
    resetMediaState,
    setAudioPeaks,
    revalidateMissingMedia,
    removeMediaCache,
  };
});
