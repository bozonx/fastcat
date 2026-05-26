import { createDevLogger } from '~/utils/dev-logger';
import { defineStore } from 'pinia';
import { ref } from 'vue';

import { useWorkspaceStore } from './workspace.store';
import { useProjectStore } from './project.store';

import { createMediaCacheFsModule } from '~/stores/media/media-cache-fs';
import { createMediaWorkerModule } from '~/stores/media/media-worker';
import { runQueuedFileAccess } from '~/utils/file-access-queue';
import { writeFileAtomic } from '~/utils/io/atomic-file-write';
import { withFileIoSlot } from '~/utils/io/io-governor';
import { postIoInitMessage } from '~/utils/io/io-budget-main';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { serializeWaveformPeaks, deserializeWaveformPeaks } from '~/utils/audio/waveform';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { thumbnailGenerator, getClipThumbnailsHash } from '~/utils/thumbnail-generator';
const log = createDevLogger('media.store');

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

  function shouldQueueCacheAccess(): boolean {
    return workspaceStore.workspaceProviderId !== 'tauri';
  }

  async function runCacheFileAccess<T>(
    kind: 'metadata' | 'waveform',
    fileName: string,
    task: () => Promise<T>,
  ): Promise<T> {
    if (!shouldQueueCacheAccess()) {
      return await task();
    }

    const projectId = projectStore.currentProjectId ?? 'no-project';
    return await runQueuedFileAccess({
      key: `opfs-media-cache:${projectId}:${kind}:${fileName}`,
      task,
    });
  }

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

    if (options?.forceRefresh) {
      try {
        const waveformsDir = await fsModule.ensureWaveformsDir();
        if (waveformsDir) {
          await runCacheFileAccess('waveform', cacheFileName, async () => {
            await waveformsDir.removeEntry(cacheFileName).catch(() => {});
          });
        }
      } catch {
        // ignore
      }
    }

    let parsedMeta: MediaMetadata | null = null;

    if (!options?.forceRefresh && metaDir) {
      try {
        const text = await runCacheFileAccess('metadata', cacheFileName, async () => {
          const cacheHandle = await metaDir.getFileHandle(cacheFileName);
          const cacheFile = await withFileIoSlot(() => cacheHandle.getFile());
          return await withFileIoSlot(() => cacheFile.text());
        });
        const parsed = JSON.parse(text) as MediaMetadata;
        if (parsed.source.size === file.size && parsed.source.lastModified === file.lastModified) {
          const mediaType = getMediaTypeFromFilename(projectRelativePath);
          const lacksVideoCompat =
            !parsed.error &&
            mediaType === 'video' &&
            parsed.video !== undefined &&
            parsed.video.canDecode === undefined;
          const lacksAudioCompat =
            !parsed.error &&
            (mediaType === 'video' || mediaType === 'audio') &&
            parsed.audio !== undefined &&
            parsed.audio.canDecode === undefined;
          const lacksImageCompat =
            !parsed.error && mediaType === 'image' && parsed.image === undefined;

          if (!lacksVideoCompat && !lacksAudioCompat && !lacksImageCompat) {
            parsedMeta = parsed;
            if (parsed.error) {
              metadataLoadFailed.value[cacheKey] = true;
            }
          }
        } else {
          // File changed! Drop stale peaks and thumbnail caches
          try {
            const waveformsDir = await fsModule.ensureWaveformsDir();
            if (waveformsDir) {
              await runCacheFileAccess('waveform', cacheFileName, async () => {
                await waveformsDir.removeEntry(cacheFileName).catch(() => {});
              });
            }
          } catch {
            // ignore
          }

          try {
            const projectId = projectStore.currentProjectId;
            if (projectId) {
              await fileThumbnailGenerator.clearThumbnail({
                projectId,
                projectRelativePath,
              });
              await thumbnailGenerator.clearThumbnails({
                projectId,
                hash: getClipThumbnailsHash({ projectId, projectRelativePath }),
              });
            }
          } catch (e) {
            log.warn('Failed to clear thumbnails on file change:', e);
          }
        }
      } catch {
        // Cache miss
      }
    }

    if (parsedMeta) {
      mediaMetadata.value[cacheKey] = parsedMeta;
    } else {
      try {
        const meta = await workerModule.extractMetadata(file);

        if (meta) {
          parsedMeta = meta;
          mediaMetadata.value[cacheKey] = meta;

          if (metaDir) {
            await runCacheFileAccess('metadata', cacheFileName, async () => {
              // We don't want to save large peaks array inside main metadata json
              const metaToSave = { ...meta };
              delete metaToSave.audioPeaks;

              await writeFileAtomic({
                dir: metaDir,
                fileName: cacheFileName,
                data: JSON.stringify(metaToSave, null, 2),
              });
            });
          }
        } else {
          // If meta is null but worker didn't throw (e.g. unknown media)
          throw new Error('Worker returned null metadata');
        }
      } catch (e) {
        log.warn('Failed to fetch metadata for', projectRelativePath, (e as Error)?.message);
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
            await runCacheFileAccess('metadata', cacheFileName, async () => {
              await writeFileAtomic({
                dir: metaDir,
                fileName: cacheFileName,
                data: JSON.stringify(errorMeta, null, 2),
              });
            });
          } catch {
            // Ignore OPFS write error
          }
        }

        return null;
      }
    }

    // Try to load cached peaks for whatever metadata we ended up with
    if (parsedMeta && !parsedMeta.error) {
      const waveformsDir = await fsModule.ensureWaveformsDir();
      if (waveformsDir) {
        try {
          const arrayBuffer = await runCacheFileAccess('waveform', cacheFileName, async () => {
            const peaksHandle = await waveformsDir.getFileHandle(cacheFileName);
            const peaksFile = await withFileIoSlot(() => peaksHandle.getFile());
            return await withFileIoSlot(() => peaksFile.arrayBuffer());
          });
          const uint8 = new Uint8Array(arrayBuffer);
          if (uint8[0] === 0x5b /* '[' character in UTF-8 */) {
            const decoder = new TextDecoder();
            const text = decoder.decode(uint8);
            const peaksData = JSON.parse(text) as number[][];
            parsedMeta.audioPeaks = peaksData.map((channel) => new Float32Array(channel));
          } else {
            const deserialized = deserializeWaveformPeaks(arrayBuffer);
            if (deserialized) {
              parsedMeta.audioPeaks = deserialized;
            }
          }
        } catch {
          // No cached peaks
        }
      }
    }

    return parsedMeta;
  }

  function setAudioPeaks(projectRelativePath: string, peaks: Float32Array[]) {
    if (mediaMetadata.value[projectRelativePath]) {
      mediaMetadata.value[projectRelativePath].audioPeaks = peaks;
    }

    const binaryData = serializeWaveformPeaks(peaks);

    // Serialize peaks writes per-path to avoid concurrent createWritable() races on the
    // same OPFS entry which can yield truncated/interleaved data for long audio.
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
          await runCacheFileAccess('waveform', cacheFileName, async () => {
            await writeFileAtomic({
              dir: waveformsDir,
              fileName: cacheFileName,
              data: binaryData,
            });
          });
        } catch (e) {
          log.warn('Failed to write peaks', e);
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

    const cacheFileName = fsModule.getCacheFileName(projectRelativePath);

    try {
      const metaDir = await fsModule.ensureFilesMetaDir();
      if (metaDir) {
        await runCacheFileAccess('metadata', cacheFileName, async () => {
          await metaDir.removeEntry(cacheFileName);
        });
      }
    } catch {
      // ignore
    }

    try {
      const waveformsDir = await fsModule.ensureWaveformsDir();
      if (waveformsDir) {
        await runCacheFileAccess('waveform', cacheFileName, async () => {
          await waveformsDir.removeEntry(cacheFileName);
        });
      }
    } catch {
      // ignore
    }

    try {
      const projectId = projectStore.currentProjectId;
      if (projectId) {
        await fileThumbnailGenerator.clearThumbnail({
          projectId,
          projectRelativePath,
        });
        await thumbnailGenerator.clearThumbnails({
          projectId,
          hash: getClipThumbnailsHash({ projectId, projectRelativePath }),
        });
      }
    } catch (e) {
      log.warn('Failed to clear thumbnails on removeMediaCache:', e);
    }
  }

  let sharedAudioDecodeWorker: Worker | null = null;
  const decodePending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
  >();
  let decodeCallId = 0;

  function ensureSharedAudioDecodeWorker() {
    if (sharedAudioDecodeWorker) return sharedAudioDecodeWorker;

    sharedAudioDecodeWorker = new Worker(
      new URL('~/workers/audio-decode.worker.ts', import.meta.url),
      {
        type: 'module',
        name: 'audio-decode-shared',
      },
    );
    postIoInitMessage(sharedAudioDecodeWorker);

    sharedAudioDecodeWorker.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.type !== 'decode-result') return;
      const pending = decodePending.get(data.id);
      if (!pending) return;
      decodePending.delete(data.id);

      if (!data.ok) {
        pending.reject(new Error(data.error?.message || 'Audio decode failed'));
        return;
      }
      pending.resolve(data.result);
    });

    sharedAudioDecodeWorker.addEventListener('error', (event) => {
      log.error('[SharedAudioDecodeWorker] Worker error', event);
      for (const [, pending] of decodePending.entries()) {
        pending.reject(new Error('Audio decode worker crashed'));
      }
      decodePending.clear();
      sharedAudioDecodeWorker = null;
    });

    return sharedAudioDecodeWorker;
  }

  async function extractPeaks(
    file: File,
    sourceKey: string,
    options?: { maxLength?: number; precision?: number },
  ): Promise<Float32Array[] | null> {
    const worker = ensureSharedAudioDecodeWorker();
    return new Promise<Float32Array[] | null>((resolve) => {
      const id = ++decodeCallId;
      decodePending.set(id, {
        resolve: (result: unknown) => {
          const res = result as { peaks?: Float32Array[] } | null;
          resolve(res?.peaks || null);
        },
        reject: (err: unknown) => {
          log.warn('Failed to extract peaks in shared worker', err);
          resolve(null);
        },
      });
      worker.postMessage({
        type: 'extract-peaks',
        id,
        sourceKey,
        blob: file,
        options,
      });
    });
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
    extractPeaks,
  };
});
