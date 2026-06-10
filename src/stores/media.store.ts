import { createDevLogger } from '~/utils/dev-logger';
import { defineStore } from 'pinia';
import { ref } from 'vue';

import { useWorkspaceStore } from './workspace.store';
import { useProjectStore } from './project.store';

import { createMediaCacheFsModule } from '~/stores/media/media-cache-fs';
import { createMediaWorkerModule } from '~/stores/media/media-worker';
import { runQueuedFileAccess } from '~/utils/file-access-queue';
import { useVfs } from '~/composables/useVfs';
import { postIoInitMessage } from '~/utils/io/io-budget-main';
import { getMediaTypeFromFilename, BROWSER_NATIVE_IMAGE_EXTENSIONS } from '~/utils/media-types';
import {
  serializeWaveformPeaks,
  deserializeWaveformPeaks,
  serializeWaveformCacheEntry,
  readWaveformCacheEntry,
  isWaveformCacheEntry,
} from '~/utils/audio/waveform';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { thumbnailGenerator, getClipThumbnailsHash } from '~/utils/thumbnail-generator';
import { isTauriRuntime } from '~/utils/runtime';
import {
  getNativeFileHandlePath,
  nativeMediaMetadata,
  nativeMediaExtractPeaks,
} from '~/utils/tauri-media-processing';
import { isLazyTauriFile } from '~/stores/workspace/provider/tauri-handle';

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
   *  in RAM instead of ~40 MB. Persisted to OPFS via a fingerprinted binary
   *  envelope (see serializeWaveformCacheEntry); legacy JSON `number[][]` and
   *  bare-binary blobs are still read for backward compatibility. */
  audioPeaks?: Float32Array[];
  error?: boolean;
}

export const useMediaStore = defineStore('media', () => {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();

  const fsModule = createMediaCacheFsModule({
    getProjectId: () => projectStore.currentProjectId,
  });

  // Lazy: the VFS plugin initializes after stores are set up.
  const getVfs = () => useVfs();

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
    log.debug('[getOrFetchMetadataByPath] path=', path, 'file=', file?.name, 'size=', file?.size);
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
          await loadCachedAudioPeaks({
            cacheKey,
            cacheFileName: fsModule.getCacheFileName(projectRelativePath),
            metadata: cached,
            mediaType,
          });
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

  async function resolveNativePath(path: string): Promise<string | null> {
    if (path.startsWith('external:')) {
      const cleanPath = path.slice('external:'.length);
      if (!cleanPath.startsWith('/remote') && !cleanPath.startsWith('remote:')) {
        return cleanPath;
      }
      return null;
    }
    if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
      if (!path.startsWith('/remote') && !path.startsWith('remote:')) {
        return path;
      }
      return null;
    }
    const handle = await projectStore.getFileHandleByPath(path);
    return getNativeFileHandlePath(handle);
  }

  async function fetchMetadataInternal(
    file: File,
    projectRelativePath: string,
    options?: { forceRefresh?: boolean },
  ): Promise<MediaMetadata | null> {
    const cacheKey = projectRelativePath;

    const metaPath = fsModule.getFilesMetaFilePath(projectRelativePath);
    const cacheFileName = fsModule.getCacheFileName(projectRelativePath);

    if (options?.forceRefresh) {
      try {
        const waveformsPath = fsModule.getWaveformsFilePath(projectRelativePath);
        if (waveformsPath) {
          await runCacheFileAccess('waveform', cacheFileName, async () => {
            await getVfs().deleteEntry(waveformsPath);
          });
        }
      } catch {
        // ignore
      }
    }

    let parsedMeta: MediaMetadata | null = null;

    if (!options?.forceRefresh && metaPath) {
      try {
        const text = await runCacheFileAccess('metadata', cacheFileName, async () => {
          const cacheFile = await getVfs().getFile(metaPath);
          if (!cacheFile) throw new Error('media metadata cache miss');
          return await cacheFile.text();
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
          const lacksContainer =
            !parsed.error &&
            (mediaType === 'video' || mediaType === 'audio') &&
            parsed.container === undefined;

          if (!lacksVideoCompat && !lacksAudioCompat && !lacksImageCompat && !lacksContainer) {
            parsedMeta = parsed;
            log.debug(
              '[fetchMetadataInternal] using cached meta for',
              projectRelativePath,
              'duration=',
              parsed.duration,
              'container=',
              parsed.container,
              'error=',
              parsed.error,
            );
            if (parsed.error) {
              metadataLoadFailed.value[cacheKey] = true;
            }
          } else {
            log.debug(
              '[fetchMetadataInternal] cache rejected for',
              projectRelativePath,
              'lacksVideoCompat=',
              lacksVideoCompat,
              'lacksAudioCompat=',
              lacksAudioCompat,
              'lacksImageCompat=',
              lacksImageCompat,
              'lacksContainer=',
              lacksContainer,
            );
          }
        } else {
          // File changed! Drop stale peaks and thumbnail caches
          try {
            const waveformsPath = fsModule.getWaveformsFilePath(projectRelativePath);
            if (waveformsPath) {
              await runCacheFileAccess('waveform', cacheFileName, async () => {
                await getVfs().deleteEntry(waveformsPath);
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
        let meta: MediaMetadata | null = null;
        if (isTauriRuntime()) {
          const nativePath = await resolveNativePath(projectRelativePath);
          log.debug('[fetchMetadataInternal] nativePath=', nativePath);
          if (nativePath) {
            let nativeMeta;
            try {
              nativeMeta = await nativeMediaMetadata(nativePath);
              log.debug(
                '[fetchMetadataInternal] nativeMeta.duration=',
                nativeMeta.duration,
                'video=',
                !!nativeMeta.video,
                'audio=',
                !!nativeMeta.audio,
              );
            } catch (e) {
              log.debug('[fetchMetadataInternal] nativeMediaMetadata error:', e);
              throw e;
            }
            const mediaType = getMediaTypeFromFilename(projectRelativePath);

            if (mediaType === 'image') {
              const ext = projectRelativePath.split('.').pop()?.toLowerCase() ?? '';
              meta = {
                source: { size: file.size, lastModified: file.lastModified },
                duration: 0,
                image: {
                  canDisplay: BROWSER_NATIVE_IMAGE_EXTENSIONS.includes(ext),
                  width: nativeMeta.video?.width ?? 0,
                  height: nativeMeta.video?.height ?? 0,
                },
              };
            } else {
              meta = {
                source: { size: file.size, lastModified: file.lastModified },
                duration: nativeMeta.duration,
                container: nativeMeta.container,
              };
              if (nativeMeta.video) {
                const normalizedRotation =
                  ((Math.round(nativeMeta.video.rotation ?? 0) % 360) + 360) % 360;
                const isQuarterTurn = normalizedRotation === 90 || normalizedRotation === 270;
                meta.video = {
                  width: nativeMeta.video.width,
                  height: nativeMeta.video.height,
                  displayWidth: isQuarterTurn ? nativeMeta.video.height : nativeMeta.video.width,
                  displayHeight: isQuarterTurn ? nativeMeta.video.width : nativeMeta.video.height,
                  rotation: nativeMeta.video.rotation ?? 0,
                  codec: nativeMeta.video.codec,
                  parsedCodec: nativeMeta.video.codec,
                  fps: nativeMeta.video.fps,
                  bitrate: nativeMeta.video.bitrate ?? undefined,
                  canDecode: true,
                };
              }
              if (nativeMeta.audio) {
                meta.audio = {
                  codec: nativeMeta.audio.codec,
                  parsedCodec: nativeMeta.audio.codec,
                  sampleRate: nativeMeta.audio.sampleRate ?? 48000,
                  channels: nativeMeta.audio.channels ?? 2,
                  bitrate: nativeMeta.audio.bitrate ?? undefined,
                  canDecode: true,
                };
              }
            }
          } else {
            throw new Error(`Could not resolve native file path for: ${projectRelativePath}`);
          }
        }

        if (!meta) {
          meta = await workerModule.extractMetadata(file);
        }

        if (meta) {
          parsedMeta = meta;
          mediaMetadata.value[cacheKey] = meta;

          if (metaPath) {
            await runCacheFileAccess('metadata', cacheFileName, async () => {
              // We don't want to save large peaks array inside main metadata json
              const metaToSave = { ...meta };
              delete metaToSave.audioPeaks;

              await getVfs().writeFile(metaPath, JSON.stringify(metaToSave, null, 2));
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

        if (metaPath) {
          try {
            await runCacheFileAccess('metadata', cacheFileName, async () => {
              await getVfs().writeFile(metaPath, JSON.stringify(errorMeta, null, 2));
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
      await loadCachedAudioPeaks({
        cacheKey,
        cacheFileName,
        metadata: parsedMeta,
        mediaType: getMediaTypeFromFilename(projectRelativePath),
      });
    }

    return parsedMeta;
  }

  async function loadCachedAudioPeaks(params: {
    cacheKey: string;
    cacheFileName: string;
    metadata: MediaMetadata;
    mediaType: ReturnType<typeof getMediaTypeFromFilename>;
  }): Promise<boolean> {
    if (params.metadata.error || params.metadata.audioPeaks) {
      return Boolean(params.metadata.audioPeaks);
    }
    if (params.mediaType !== 'video' && params.mediaType !== 'audio') return false;

    const waveformsPath = fsModule.getWaveformsFilePath(params.cacheKey);
    if (!waveformsPath) return false;

    try {
      const arrayBuffer = await runCacheFileAccess('waveform', params.cacheFileName, async () => {
        const peaksFile = await getVfs().getFile(waveformsPath);
        if (!peaksFile) throw new Error('waveform cache miss');
        return await peaksFile.arrayBuffer();
      });
      const uint8 = new Uint8Array(arrayBuffer);
      if (uint8[0] === 0x5b /* '[' character in UTF-8 */) {
        // Legacy JSON format (no fingerprint): trusted optimistically.
        const decoder = new TextDecoder();
        const text = decoder.decode(uint8);
        const peaksData = JSON.parse(text) as number[][];
        params.metadata.audioPeaks = peaksData.map((channel) => new Float32Array(channel));
      } else if (isWaveformCacheEntry(arrayBuffer)) {
        // Fingerprinted envelope: only reuse when it matches the current source.
        const entry = readWaveformCacheEntry(arrayBuffer);
        if (
          entry &&
          entry.fingerprint.size === params.metadata.source.size &&
          entry.fingerprint.lastModified === params.metadata.source.lastModified
        ) {
          params.metadata.audioPeaks = entry.peaks;
        } else {
          // Stale (belongs to a different file at this path) — drop it so a fresh
          // extraction replaces it instead of rendering the wrong waveform.
          try {
            await runCacheFileAccess('waveform', params.cacheFileName, async () => {
              await getVfs().deleteEntry(waveformsPath);
            });
          } catch {
            // ignore
          }
          return false;
        }
      } else {
        // Legacy bare-binary format (no fingerprint): trusted optimistically.
        const deserialized = deserializeWaveformPeaks(arrayBuffer);
        if (deserialized) {
          params.metadata.audioPeaks = deserialized;
        }
      }
    } catch {
      return false;
    }

    if (params.metadata.audioPeaks) {
      mediaMetadata.value[params.cacheKey] = params.metadata;
      return true;
    }

    return false;
  }

  function setAudioPeaks(projectRelativePath: string, peaks: Float32Array[]) {
    let targetPath = projectRelativePath;
    let metadata = mediaMetadata.value[targetPath];
    if (!metadata) {
      if (projectRelativePath.startsWith('external:')) {
        const clean = projectRelativePath.slice('external:'.length);
        if (mediaMetadata.value[clean]) {
          targetPath = clean;
          metadata = mediaMetadata.value[clean];
        }
      } else {
        const prefixed = `external:${projectRelativePath}`;
        if (mediaMetadata.value[prefixed]) {
          targetPath = prefixed;
          metadata = mediaMetadata.value[prefixed];
        }
      }
    }

    mediaMetadata.value[targetPath] = {
      ...(metadata || { source: { size: 0, lastModified: 0 }, duration: 0 }),
      audioPeaks: peaks,
    };

    // Persist with a source fingerprint when we know it, so the blob can be
    // validated on reload and never served for a different file at this path.
    const source = metadata?.source;
    const binaryData = source
      ? serializeWaveformCacheEntry(peaks, {
          size: source.size,
          lastModified: source.lastModified,
        })
      : serializeWaveformPeaks(peaks);

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
          const waveformsPath = fsModule.getWaveformsFilePath(projectRelativePath);
          if (!waveformsPath) return;
          await runCacheFileAccess('waveform', cacheFileName, async () => {
            await getVfs().writeFile(waveformsPath, new Uint8Array(binaryData));
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
      const metaPath = fsModule.getFilesMetaFilePath(projectRelativePath);
      if (metaPath) {
        await runCacheFileAccess('metadata', cacheFileName, async () => {
          await getVfs().deleteEntry(metaPath);
        });
      }
    } catch {
      // ignore
    }

    try {
      const waveformsPath = fsModule.getWaveformsFilePath(projectRelativePath);
      if (waveformsPath) {
        await runCacheFileAccess('waveform', cacheFileName, async () => {
          await getVfs().deleteEntry(waveformsPath);
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

  async function removeMediaCacheForDirectory(dirPath: string) {
    const prefix = dirPath ? `${dirPath}/` : '';
    const pathsToRemove: string[] = [];

    // Find all keys starting with dirPath/ or equal to dirPath
    for (const path of Object.keys(mediaMetadata.value)) {
      if (path === dirPath || (prefix && path.startsWith(prefix))) {
        pathsToRemove.push(path);
      }
    }

    for (const path of Object.keys(metadataLoadFailed.value)) {
      if (path === dirPath || (prefix && path.startsWith(prefix))) {
        if (!pathsToRemove.includes(path)) pathsToRemove.push(path);
      }
    }

    for (const path of Object.keys(metadataLoading.value)) {
      if (path === dirPath || (prefix && path.startsWith(prefix))) {
        if (!pathsToRemove.includes(path)) pathsToRemove.push(path);
      }
    }

    for (const path of Object.keys(missingPaths.value)) {
      if (path === dirPath || (prefix && path.startsWith(prefix))) {
        if (!pathsToRemove.includes(path)) pathsToRemove.push(path);
      }
    }

    await Promise.all(pathsToRemove.map((path) => removeMediaCache(path)));
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
    const maxLength = options?.maxLength || 8000;

    if (isTauriRuntime()) {
      const nativePath = await resolveNativePath(sourceKey);
      if (nativePath) {
        const nativePeaks = await nativeMediaExtractPeaks(
          nativePath,
          maxLength,
          options?.precision,
        );
        if (nativePeaks && nativePeaks.length > 0) {
          return nativePeaks;
        }
      }
      return null;
    }

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
      const payload: {
        type: 'extract-peaks';
        id: number;
        sourceKey: string;
        blob?: File;
        arrayBuffer?: ArrayBuffer;
        options?: { maxLength?: number; precision?: number };
      } = {
        type: 'extract-peaks',
        id,
        sourceKey,
        options,
      };
      if (isLazyTauriFile(file)) {
        file
          .arrayBuffer()
          .then((buf) => {
            payload.arrayBuffer = buf;
            worker.postMessage(payload, [buf]);
          })
          .catch((err: unknown) => {
            log.warn('Failed to read lazy file for peaks extraction', err);
            decodePending.delete(id);
            resolve(null);
          });
      } else {
        payload.blob = file;
        worker.postMessage(payload);
      }
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
    removeMediaCacheForDirectory,
    extractPeaks,
  };
});
