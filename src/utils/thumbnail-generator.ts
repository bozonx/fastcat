import { createDevLogger } from '~/utils/dev-logger';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { TIMELINE_CLIP_THUMBNAILS } from '~/utils/constants';
import {
  BaseThumbnailGenerator,
  type BaseThumbnailTask,
  hashString,
} from './base-thumbnail-generator';
import { toProjectTempVfsPath } from '~/utils/storage-topology';
import { useVfs } from '~/composables/useVfs';
import { getThumbnailWorkerClient, setThumbnailHostApi } from '~/utils/video-editor/worker-client';
import { createProjectHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { addMediaTask, MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';
import { randomToken } from '~/utils/ids';
import { isTauriRuntime } from '~/utils/runtime';
import { toError } from '~/utils/errors';
import { isNotFoundError } from '~/utils/error-helpers';
import { getNativeFileHandlePath, nativeVideoFrameWebps } from '~/utils/tauri-media-processing';
import { normalizeMediaCachePath } from '~/utils/media-cache-path';
import {
  createTimelineFrameSource,
  type ThumbnailFrameSource,
} from '~/utils/timeline-frame-thumbnail-source';
const log = createDevLogger('thumbnail-generator');
const CLIP_THUMBNAIL_HASH_VERSION = 2;
const NATIVE_THUMBNAIL_BATCH_SIZE = 128;
const NATIVE_THUMBNAIL_SEEK_THRESHOLD_SECONDS = 1;
const WORKER_THUMBNAIL_BATCH_SIZE = 32;

export interface ThumbnailTask extends BaseThumbnailTask {
  duration: number; // video duration in seconds
  /**
   * Source kind. `media` (default) decodes the source file frame-by-frame;
   * `timeline` composites a nested `.otio` document at each requested time
   * through the same compositor the monitor/export use.
   */
  sourceKind?: 'media' | 'timeline';
  requestedTimesS?: number[];
  listenerKey?: string;
  onProgress?: (progress: number, url: string, time: number) => void;
  onComplete?: () => void;
  onError?: (err: Error) => void;
}

interface ThumbnailTaskListener {
  onProgress?: ThumbnailTask['onProgress'];
  onComplete?: ThumbnailTask['onComplete'];
  onError?: ThumbnailTask['onError'];
}

export function getClipThumbnailsHash(input: {
  projectId: string;
  projectRelativePath: string;
}): string {
  const projectRelativePath = normalizeMediaCachePath(input.projectRelativePath);
  return hashString(`v${CLIP_THUMBNAIL_HASH_VERSION}:${input.projectId}:${projectRelativePath}`);
}

/**
 * Hash for nested-timeline clip thumbnails. Folds a content `fingerprint`
 * (e.g. the `.otio` file's mtime) into the key so edits to the nested timeline
 * invalidate the cached frames instead of showing stale previews. The `nested:`
 * segment also keeps these in a separate namespace from plain media clips.
 */
export function getNestedTimelineThumbnailsHash(input: {
  projectId: string;
  projectRelativePath: string;
  fingerprint: number | string;
}): string {
  const projectRelativePath = normalizeMediaCachePath(input.projectRelativePath);
  return hashString(
    `v${CLIP_THUMBNAIL_HASH_VERSION}:nested:${input.projectId}:${projectRelativePath}:${input.fingerprint}`,
  );
}

function getTimelineThumbnailVfsPath(projectId: string, hash?: string): string {
  const leafSegments = hash
    ? ['thumbnails', TIMELINE_CLIP_THUMBNAILS.DIR_NAME, hash]
    : ['thumbnails', TIMELINE_CLIP_THUMBNAILS.DIR_NAME];

  return toProjectTempVfsPath(projectId, leafSegments);
}

class ThumbnailGenerator extends BaseThumbnailGenerator<ThumbnailTask, Map<number, string>> {
  protected maxCacheEntries = 50;
  /** Total cap on individual blob URLs across all clips — prevents unbounded memory on long videos. */
  private maxTotalCachedUrls = 1500;
  private listeners = new Map<string, Map<string, ThumbnailTaskListener>>();
  private pendingRequestedTimes = new Map<string, Set<number>>();
  private opfsCheckedTimes = new Map<string, Set<number>>();
  private opfsExistingFiles = new Map<string, Set<string>>();

  protected override evictCacheIfNeeded() {
    super.evictCacheIfNeeded();
    while (this.cache.size > 0 && this.totalCachedUrlCount() > this.maxTotalCachedUrls) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const value = this.cache.get(oldestKey);
      if (value) this.revokeCacheValue(value);
      this.cache.delete(oldestKey);
      this.listeners.delete(oldestKey);
      this.pendingRequestedTimes.delete(oldestKey);
      this.opfsCheckedTimes.delete(oldestKey);
      this.opfsExistingFiles.delete(oldestKey);
    }
  }

  private totalCachedUrlCount(): number {
    let total = 0;
    for (const urls of this.cache.values()) total += urls.size;
    return total;
  }

  protected get taskPriority(): number {
    return MEDIA_TASK_PRIORITIES.timelineThumbnail;
  }

  protected revokeCacheValue(_urls: Map<number, string>): void {
    _urls.forEach((url) => URL.revokeObjectURL(url));
  }

  protected override clearAdditionalState(): void {
    this.listeners.clear();
    this.pendingRequestedTimes.clear();
    this.opfsCheckedTimes.clear();
    this.opfsExistingFiles.clear();
  }

  protected onCacheHit(task: ThumbnailTask, urls: Map<number, string>): void {
    const entries = Array.from(urls.entries()).sort(([a], [b]) => a - b);
    entries.forEach(([time, url], index) => {
      task.onProgress?.((index + 1) / entries.length, url, time);
    });
    task.onComplete?.();
  }

  private buildExpectedTimes(duration: number): number[] {
    const timesS: number[] = [];
    const interval = TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS;
    const count = Math.floor(duration / interval);
    for (let i = 0; i <= count; i++) {
      timesS.push(i * interval);
    }
    return timesS;
  }

  private normalizeRequestedTimes(task: ThumbnailTask): number[] {
    const sourceTimes = task.requestedTimesS?.length
      ? task.requestedTimesS
      : this.buildExpectedTimes(task.duration);
    const interval = TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS;
    const normalized = new Set<number>();

    for (const time of sourceTimes) {
      if (!Number.isFinite(time)) continue;
      const gridTime = Math.round(time / interval) * interval;
      if (gridTime < 0 || gridTime > task.duration + 1e-6) continue;
      normalized.add(Math.round(gridTime));
    }

    return Array.from(normalized).sort((a, b) => a - b);
  }

  private getRequestedTimes(task: ThumbnailTask): number[] {
    const pending = this.pendingRequestedTimes.get(task.id);
    if (pending?.size) {
      return Array.from(pending).sort((a, b) => a - b);
    }
    return this.normalizeRequestedTimes(task);
  }

  private mergeRequestedTimes(task: ThumbnailTask): void {
    const nextTimes = this.normalizeRequestedTimes(task);
    const pending = this.pendingRequestedTimes.get(task.id) ?? new Set<number>();
    nextTimes.forEach((time) => pending.add(time));
    this.pendingRequestedTimes.set(task.id, pending);
  }

  private isCompleteCache(urls: Map<number, string>, task: ThumbnailTask): boolean {
    return this.normalizeRequestedTimes(task).every((time) => urls.has(Math.round(time)));
  }

  private addListener(task: ThumbnailTask): ThumbnailTaskListener {
    const listener: ThumbnailTaskListener = {
      onProgress: task.onProgress,
      onComplete: task.onComplete,
      onError: task.onError,
    };
    const listeners = this.listeners.get(task.id) ?? new Map<string, ThumbnailTaskListener>();
    const listenerKey = task.listenerKey ?? `${Date.now()}:${randomToken()}:${listeners.size}`;
    listeners.set(listenerKey, listener);
    this.listeners.set(task.id, listeners);
    return listener;
  }

  private removeListener(id: string, listener: ThumbnailTaskListener): void {
    const listeners = this.listeners.get(id);
    if (!listeners) return;
    for (const [key, currentListener] of listeners.entries()) {
      if (currentListener === listener) {
        listeners.delete(key);
        break;
      }
    }
    if (listeners.size === 0) {
      this.listeners.delete(id);
    }
  }

  private emitProgress(id: string, progress: number, url: string, time: number): void {
    this.listeners.get(id)?.forEach((listener) => listener.onProgress?.(progress, url, time));
  }

  private emitComplete(id: string): void {
    this.listeners.get(id)?.forEach((listener) => listener.onComplete?.());
    this.listeners.delete(id);
  }

  private emitError(id: string, err: Error): void {
    this.listeners.get(id)?.forEach((listener) => listener.onError?.(err));
    this.listeners.delete(id);
  }

  private replayCacheToTask(task: ThumbnailTask, urls: Map<number, string>): void {
    const entries = Array.from(urls.entries()).sort(([a], [b]) => a - b);
    const requestedTimes = new Set(this.normalizeRequestedTimes(task));
    const visibleEntries = entries.filter(([time]) => requestedTimes.has(time));
    if (visibleEntries.length === 0) return;
    visibleEntries.forEach(([time, url], index) => {
      task.onProgress?.(Math.min(1, (index + 1) / visibleEntries.length), url, time);
    });
  }

  override cancelTask(id: string) {
    if (!id) return;
    this.listeners.delete(id);
    this.pendingRequestedTimes.delete(id);
    this.opfsCheckedTimes.delete(id);
    this.opfsExistingFiles.delete(id);
    if (this.activeTasks.has(id)) {
      if (!isTauriRuntime()) {
        void getThumbnailWorkerClient()
          .client.cancelExport(id)
          .catch(() => {});
      }
    }
    super.cancelTask(id);
  }

  override addTask(task: ThumbnailTask) {
    task = {
      ...task,
      projectRelativePath: normalizeMediaCachePath(task.projectRelativePath),
    };

    if (this.isCancelled(task.id)) {
      this.cancelledTasks.delete(task.id);
    }

    this.mergeRequestedTimes(task);

    const cached = this.cache.get(task.id);
    if (cached) {
      this.touchCacheEntry(task.id);
      if (this.isCompleteCache(cached, task)) {
        this.onCacheHit(task, cached);
        return;
      }
      this.replayCacheToTask(task, cached);
    }

    const listener = this.addListener(task);

    if (this.queuedTasks.has(task.id) || this.activeTasks.has(task.id)) {
      return;
    }

    this.queuedTasks.add(task.id);

    void addMediaTask(
      async () => {
        this.queuedTasks.delete(task.id);

        if (this.isCancelled(task.id)) {
          this.cancelledTasks.delete(task.id);
          this.removeListener(task.id, listener);
          return;
        }

        this.activeTasks.add(task.id);

        try {
          await this.executeTask({
            ...task,
            onProgress: (progress, url, time) => this.emitProgress(task.id, progress, url, time),
            onComplete: () => this.emitComplete(task.id),
            onError: (err) => this.emitError(task.id, err),
          });
        } catch (e) {
          const err = toError(e);
          log.error(`Task ${task.id} failed:`, err);
          this.emitError(task.id, err);
        } finally {
          this.activeTasks.delete(task.id);
          this.cancelledTasks.delete(task.id);

          const pending = this.pendingRequestedTimes.get(task.id);
          if (pending && pending.size > 0) {
            if (!this.queuedTasks.has(task.id)) {
              this.queuedTasks.add(task.id);
              void addMediaTask(
                async () => {
                  this.queuedTasks.delete(task.id);

                  if (this.isCancelled(task.id)) {
                    this.cancelledTasks.delete(task.id);
                    this.removeListener(task.id, listener);
                    return;
                  }

                  this.activeTasks.add(task.id);

                  try {
                    await this.executeTask({
                      ...task,
                      onProgress: (progress, url, time) =>
                        this.emitProgress(task.id, progress, url, time),
                      onComplete: () => this.emitComplete(task.id),
                      onError: (err) => this.emitError(task.id, err),
                    });
                  } catch (e) {
                    const err = toError(e);
                    log.error(`Task ${task.id} failed:`, err);
                    this.emitError(task.id, err);
                  } finally {
                    this.activeTasks.delete(task.id);
                    this.cancelledTasks.delete(task.id);
                  }
                },
                { priority: this.taskPriority },
              ).catch((e) => {
                const err = toError(e);
                this.queuedTasks.delete(task.id);
                this.cancelledTasks.delete(task.id);
                log.error(`Task ${task.id} failed:`, err);
                this.emitError(task.id, err);
              });
            }
          } else {
            this.pendingRequestedTimes.delete(task.id);
            this.emitComplete(task.id);
          }
        }
      },
      { priority: this.taskPriority },
    ).catch((e) => {
      const err = toError(e);
      this.queuedTasks.delete(task.id);
      this.cancelledTasks.delete(task.id);
      log.error(`Task ${task.id} failed:`, err);
      this.emitError(task.id, err);
    });
  }

  private async loadThumbnailsFromOPFS(
    task: ThumbnailTask,
    requestedTimes: number[],
  ): Promise<Map<number, string> | null> {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle && !isTauriRuntime()) return null;

    const checked = this.opfsCheckedTimes.get(task.id) ?? new Set<number>();
    const timesToCheck = requestedTimes.filter((t) => !checked.has(Math.round(t)));
    if (timesToCheck.length === 0) {
      return this.cache.get(task.id) ?? new Map<number, string>();
    }

    try {
      const vfs = useVfs();
      const vfsPath = getTimelineThumbnailVfsPath(task.projectId, task.id);

      const urls = new Map<number, string>(this.cache.get(task.id) ?? []);
      const totalFrames = requestedTimes.length;
      let framesProcessed = requestedTimes.length - timesToCheck.length;

      let existingFiles = this.opfsExistingFiles.get(task.id);
      if (!existingFiles) {
        existingFiles = new Set<string>();
        try {
          const entries = await vfs.readDirectory(vfsPath);
          for (const entry of entries) {
            if (entry.kind === 'file') {
              existingFiles.add(entry.name);
            }
          }
        } catch (e: unknown) {
          if (!isNotFoundError(e)) {
            throw e;
          }
        }
        this.opfsExistingFiles.set(task.id, existingFiles);
      }

      for (const time of timesToCheck) {
        if (this.isCancelled(task.id)) {
          this.opfsCheckedTimes.set(task.id, checked);
          return urls;
        }
        const key = Math.round(time);
        checked.add(key);
        if (urls.has(key)) {
          framesProcessed++;
          continue;
        }
        const fileName = `${key}.webp`;
        if (!existingFiles.has(fileName)) {
          continue;
        }
        try {
          const filePath = `${vfsPath}/${fileName}`;
          const blob = await vfs.readFile(filePath);
          const url = URL.createObjectURL(blob);
          const previousUrl = urls.get(key);
          if (previousUrl && previousUrl !== url) {
            URL.revokeObjectURL(previousUrl);
          }
          urls.set(key, url);
          framesProcessed++;
          if (!this.isCancelled(task.id)) {
            task.onProgress?.(framesProcessed / totalFrames, url, time);
          }
        } catch (e: unknown) {
          if (!isNotFoundError(e)) {
            throw e;
          }
        }
      }

      this.opfsCheckedTimes.set(task.id, checked);

      if (this.isCancelled(task.id)) {
        return urls;
      }

      if (urls.size > 0) {
        this.cache.set(task.id, urls);
        this.touchCacheEntry(task.id);
        this.evictCacheIfNeeded();
      }

      return urls;
    } catch (e: unknown) {
      if (!isNotFoundError(e)) {
        log.warn('Failed to load thumbnails from VFS', task.id, e);
      }
      return null;
    }
  }

  /**
   * Builds the frame source for a task. Media clips decode their source file;
   * nested-timeline clips composite the `.otio` document. Returns `null` when a
   * nested timeline has no visual content.
   */
  private async createFrameSource(task: ThumbnailTask): Promise<ThumbnailFrameSource | null> {
    if (task.sourceKind === 'timeline') {
      return createTimelineFrameSource({
        projectRelativePath: task.projectRelativePath,
        maxWidth: TIMELINE_CLIP_THUMBNAILS.WIDTH,
        maxHeight: TIMELINE_CLIP_THUMBNAILS.HEIGHT,
        quality: TIMELINE_CLIP_THUMBNAILS.QUALITY,
      });
    }
    return this.createMediaFrameSource(task);
  }

  private async createMediaFrameSource(task: ThumbnailTask): Promise<ThumbnailFrameSource> {
    const projectStore = useProjectStore();

    const sourceHandle = isTauriRuntime()
      ? await projectStore.getFileHandleByPath(task.projectRelativePath)
      : null;
    const nativeSourcePath = getNativeFileHandlePath(sourceHandle);

    // In Tauri mode we must have a native filesystem path; without it we cannot
    // generate thumbnails (web worker is unavailable in the native runtime).
    if (isTauriRuntime() && !nativeSourcePath) {
      throw new Error(`No native path for thumbnail task: ${task.projectRelativePath}`);
    }

    if (nativeSourcePath) {
      return {
        batchSize: NATIVE_THUMBNAIL_BATCH_SIZE,
        extract: (chunkTimes) =>
          nativeVideoFrameWebps({
            sourcePath: nativeSourcePath,
            timesSec: chunkTimes,
            maxWidth: TIMELINE_CLIP_THUMBNAILS.WIDTH,
            maxHeight: TIMELINE_CLIP_THUMBNAILS.HEIGHT,
            quality: TIMELINE_CLIP_THUMBNAILS.QUALITY,
            seekThresholdSec: NATIVE_THUMBNAIL_SEEK_THRESHOLD_SECONDS,
          }),
        dispose: async () => {},
      };
    }

    setThumbnailHostApi(createProjectHostApi());
    const client = getThumbnailWorkerClient().client;

    const file = await projectStore.getFileByPath(task.projectRelativePath);
    if (!file) {
      throw new Error(`Source file not found: ${task.projectRelativePath}`);
    }

    return {
      batchSize: WORKER_THUMBNAIL_BATCH_SIZE,
      extract: (chunkTimes) =>
        client.extractVideoFrameBlobs(file, {
          timesS: chunkTimes,
          maxWidth: TIMELINE_CLIP_THUMBNAILS.WIDTH,
          maxHeight: TIMELINE_CLIP_THUMBNAILS.HEIGHT,
          quality: TIMELINE_CLIP_THUMBNAILS.QUALITY,
          mimeType: 'image/webp',
          taskId: task.id,
          keepAlive: true,
        }),
      dispose: async () => {
        try {
          await client.releaseFrameExtractor(task.id);
        } catch {
          // ignore
        }
      },
    };
  }

  protected async executeTask(task: ThumbnailTask): Promise<void> {
    const workspaceStore = useWorkspaceStore();

    if (!workspaceStore.workspaceHandle && !isTauriRuntime()) {
      throw new Error('Workspace is not opened');
    }

    const frameSource = await this.createFrameSource(task);
    // A nested timeline with no visual layers (audio-only / empty) has nothing
    // to render — finish cleanly so listeners are not left hanging.
    if (!frameSource) {
      if (!this.isCancelled(task.id)) {
        this.pendingRequestedTimes.delete(task.id);
        task.onComplete?.();
      }
      return;
    }

    const vfs = useVfs();
    const vfsPath = getTimelineThumbnailVfsPath(task.projectId, task.id);
    const attemptedMissingTimes = new Set<number>();
    try {
      while (!this.isCancelled(task.id)) {
        const requestedTimes = this.getRequestedTimes(task);
        const existingUrls = await this.loadThumbnailsFromOPFS(task, requestedTimes);
        const cachedUrls = this.cache.get(task.id) ?? new Map<number, string>();
        const missingTimesS = requestedTimes.filter(
          (time) =>
            !attemptedMissingTimes.has(Math.round(time)) &&
            !cachedUrls.has(Math.round(time)) &&
            !existingUrls?.has(Math.round(time)),
        );

        if (missingTimesS.length === 0) {
          break;
        }

        const totalFrames = requestedTimes.length;
        let framesProcessed = requestedTimes.length - missingTimesS.length;
        const chunkSize = frameSource.batchSize;

        for (let i = 0; i < missingTimesS.length && !this.isCancelled(task.id); i += chunkSize) {
          const chunkTimes = missingTimesS.slice(i, i + chunkSize);
          let blobs: (Blob | null)[] = [];

          try {
            blobs = await frameSource.extract(chunkTimes, () => this.isCancelled(task.id));
          } catch (error) {
            if (this.isCancelled(task.id)) {
              return;
            }
            throw error;
          }

          for (let j = 0; j < chunkTimes.length; j++) {
            const blob = blobs[j];
            const currentTime = chunkTimes[j]!;

            if (!blob) {
              attemptedMissingTimes.add(Math.round(currentTime));
              continue;
            }

            const fileName = `${Math.round(currentTime)}.webp`;
            const filePath = `${vfsPath}/${fileName}`;
            await vfs.writeFile(filePath, blob);

            this.opfsExistingFiles.get(task.id)?.add(fileName);

            const thumbUrl = URL.createObjectURL(blob);

            const urls = this.cache.get(task.id) ?? new Map<number, string>();
            const previousUrl = urls.get(Math.round(currentTime));
            if (previousUrl && previousUrl !== thumbUrl) {
              URL.revokeObjectURL(previousUrl);
            }
            urls.set(Math.round(currentTime), thumbUrl);
            this.cache.set(task.id, urls);
            this.touchCacheEntry(task.id);
            this.evictCacheIfNeeded();

            framesProcessed++;
            if (!this.isCancelled(task.id)) {
              task.onProgress?.(framesProcessed / totalFrames, thumbUrl, currentTime);
            }
          }
        }
      }

      if (!this.isCancelled(task.id)) {
        this.pendingRequestedTimes.delete(task.id);
        task.onComplete?.();
      }
    } finally {
      this.opfsExistingFiles.delete(task.id);
      await frameSource.dispose();
    }
  }

  async clearThumbnails(input: { projectId: string; hash: string }) {
    const cachedUrls = this.cache.get(input.hash);
    if (cachedUrls) {
      this.revokeCacheValue(cachedUrls);
      this.cache.delete(input.hash);
    }
    this.listeners.delete(input.hash);
    this.pendingRequestedTimes.delete(input.hash);
    this.opfsCheckedTimes.delete(input.hash);
    this.opfsExistingFiles.delete(input.hash);

    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    try {
      const vfs = useVfs();
      const vfsPath = getTimelineThumbnailVfsPath(input.projectId, input.hash);
      await vfs.deleteEntry(vfsPath, true);
    } catch (e: unknown) {
      if (!isNotFoundError(e)) {
        log.warn('Failed to clear thumbnails for', input.hash, e);
      }
    }
  }
}

export const thumbnailGenerator = new ThumbnailGenerator();
// Exported separately (not as `export class`) so tests can construct a fresh
// instance; an inline `export` on the generic heritage clause trips Vite's
// SSR transform.
export { ThumbnailGenerator };
