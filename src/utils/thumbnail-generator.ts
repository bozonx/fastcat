import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { TIMELINE_CLIP_THUMBNAILS } from '~/utils/constants';
import {
  BaseThumbnailGenerator,
  type BaseThumbnailTask,
  ensureBaseThumbnailDir,
  hashString,
} from './base-thumbnail-generator';
import { getThumbnailWorkerClient, setThumbnailHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { addMediaTask, MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';

export interface ThumbnailTask extends BaseThumbnailTask {
  duration: number; // video duration in seconds
  onProgress?: (progress: number, url: string, time: number) => void;
  onComplete?: () => void;
  onError?: (err: Error) => void;
}

interface ThumbnailTaskListener {
  onProgress?: ThumbnailTask['onProgress'];
  onComplete?: ThumbnailTask['onComplete'];
  onError?: ThumbnailTask['onError'];
}

interface WritableFileHandle extends FileSystemFileHandle {
  createWritable: () => Promise<FileSystemWritableFileStream>;
}

function isDomExceptionName(error: unknown, name: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === name
  );
}

export function getClipThumbnailsHash(input: {
  projectId: string;
  projectRelativePath: string;
}): string {
  return hashString(`${input.projectId}:${input.projectRelativePath}`);
}

async function ensureTimelineThumbnailDir(input: {
  projectId: string;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  hash?: string;
  create?: boolean;
}): Promise<FileSystemDirectoryHandle> {
  const leafSegments = input.hash
    ? ['thumbnails', TIMELINE_CLIP_THUMBNAILS.DIR_NAME, input.hash]
    : ['thumbnails', TIMELINE_CLIP_THUMBNAILS.DIR_NAME];

  return await ensureBaseThumbnailDir({
    projectId: input.projectId,
    workspaceStore: input.workspaceStore,
    leafSegments,
    create: input.create,
  });
}

class ThumbnailGenerator extends BaseThumbnailGenerator<ThumbnailTask, Map<number, string>> {
  protected maxCacheEntries = 50;
  private listeners = new Map<string, Set<ThumbnailTaskListener>>();

  protected get taskPriority(): number {
    return MEDIA_TASK_PRIORITIES.timelineThumbnail;
  }

  protected revokeCacheValue(_urls: Map<number, string>): void {
    // Note: URL revocation is now handled by the consumers (components)
    // to avoid UI breaking when cache evicts an actively displayed thumbnail.
    // For now, we do nothing here.
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
    for (let t = 0; t <= duration; t += TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS) {
      timesS.push(t);
    }
    return timesS;
  }

  private isCompleteCache(urls: Map<number, string>, duration: number): boolean {
    return this.buildExpectedTimes(duration).every((time) => urls.has(Math.round(time)));
  }

  private addListener(task: ThumbnailTask): ThumbnailTaskListener {
    const listener: ThumbnailTaskListener = {
      onProgress: task.onProgress,
      onComplete: task.onComplete,
      onError: task.onError,
    };
    const listeners = this.listeners.get(task.id) ?? new Set<ThumbnailTaskListener>();
    listeners.add(listener);
    this.listeners.set(task.id, listeners);
    return listener;
  }

  private removeListener(id: string, listener: ThumbnailTaskListener): void {
    const listeners = this.listeners.get(id);
    if (!listeners) return;
    listeners.delete(listener);
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
    const totalFrames = this.buildExpectedTimes(task.duration).length;
    entries.forEach(([time, url], index) => {
      task.onProgress?.(Math.min(1, (index + 1) / totalFrames), url, time);
    });
  }

  override cancelTask(id: string) {
    if (!id) return;
    this.listeners.delete(id);
    super.cancelTask(id);
  }

  override addTask(task: ThumbnailTask) {
    if (this.isCancelled(task.id)) {
      this.cancelledTasks.delete(task.id);
    }

    const cached = this.cache.get(task.id);
    if (cached) {
      this.touchCacheEntry(task.id);
      if (this.isCompleteCache(cached, task.duration)) {
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
          const err = e instanceof Error ? e : new Error(String(e));
          console.error(`Task ${task.id} failed:`, err);
          this.emitError(task.id, err);
        } finally {
          this.activeTasks.delete(task.id);
        }
      },
      { priority: this.taskPriority },
    ).catch((e) => {
      const err = e instanceof Error ? e : new Error(String(e));
      this.queuedTasks.delete(task.id);
      console.error(`Task ${task.id} failed:`, err);
      this.emitError(task.id, err);
    });
  }

  private async loadThumbnailsFromOPFS(task: ThumbnailTask): Promise<Map<number, string> | null> {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return null;

    try {
      const hashDir = await ensureTimelineThumbnailDir({
        projectId: task.projectId,
        workspaceStore,
        hash: task.id,
      });

      const urls = new Map<number, string>();
      const expectedTimes = this.buildExpectedTimes(task.duration);
      const totalFrames = expectedTimes.length;
      let framesProcessed = 0;

      // We expect filenames to be "0.webp", "5.webp", "10.webp", etc.
      for (const time of expectedTimes) {
        if (this.isCancelled(task.id)) {
          return urls;
        }
        const fileName = `${Math.round(time)}.webp`;
        try {
          const fileHandle = await hashDir.getFileHandle(fileName);
          const file = await fileHandle.getFile();
          const buffer = await file.arrayBuffer();
          const blob = new Blob([buffer], { type: file.type });
          const url = URL.createObjectURL(blob);
          urls.set(Math.round(time), url);
          framesProcessed++;
          if (!this.isCancelled(task.id)) {
            task.onProgress?.(framesProcessed / totalFrames, url, time);
          }
        } catch (e: unknown) {
          if (isDomExceptionName(e, 'NotFoundError')) {
            continue;
          }
          throw e;
        }
      }

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
      if (!isDomExceptionName(e, 'NotFoundError')) {
        console.warn('Failed to load thumbnails from OPFS', task.id, e);
      }
      return null;
    }
  }

  protected async executeTask(task: ThumbnailTask): Promise<void> {
    const existingUrls = await this.loadThumbnailsFromOPFS(task);
    const timesS = this.buildExpectedTimes(task.duration);
    const missingTimesS = timesS.filter((time) => !existingUrls?.has(Math.round(time)));

    if (missingTimesS.length === 0) {
      task.onComplete?.();
      return;
    }

    if (this.isCancelled(task.id)) return;

    const workspaceStore = useWorkspaceStore();
    const projectStore = useProjectStore();

    if (!workspaceStore.workspaceHandle) {
      throw new Error('Workspace is not opened');
    }

    const file = await projectStore.getFileByPath(task.projectRelativePath);
    if (!file) throw new Error(`Source file not found: ${task.projectRelativePath}`);

    if (missingTimesS.length === 0) return;

    const totalFrames = timesS.length;
    let framesProcessed = existingUrls?.size ?? 0;

    setThumbnailHostApi(
      createVideoCoreHostApi({
        getCurrentProjectId: () => projectStore.currentProjectId,
        getWorkspaceHandle: () => workspaceStore.workspaceHandle,
        getResolvedStorageTopology: () => workspaceStore.resolvedStorageTopology,
        getFileHandleByPath: async (path) => projectStore.getFileHandleByPath(path),
        getFileByPath: async (path) => projectStore.getFileByPath(path),
        onExportProgress: () => {},
      }),
    );

    const { client } = getThumbnailWorkerClient();

    const blobs = await client.extractVideoFrameBlobs(file, {
      timesS: missingTimesS,
      maxWidth: TIMELINE_CLIP_THUMBNAILS.WIDTH,
      maxHeight: TIMELINE_CLIP_THUMBNAILS.HEIGHT,
      quality: TIMELINE_CLIP_THUMBNAILS.QUALITY,
      mimeType: 'image/webp',
    });

    const dir = await ensureTimelineThumbnailDir({
      projectId: task.projectId,
      workspaceStore,
      hash: task.id,
      create: true,
    });

    for (let i = 0; i < missingTimesS.length; i++) {
      const blob = blobs[i];
      const currentTime = missingTimesS[i]!;

      if (!blob) continue;

      const fileName = `${Math.round(currentTime)}.webp`;
      const fileHandle = await dir.getFileHandle(fileName, { create: true });
      const writable = await (fileHandle as WritableFileHandle).createWritable();
      await writable.write(blob);
      await writable.close();

      const thumbUrl = URL.createObjectURL(blob);

      const urls = this.cache.get(task.id) ?? new Map<number, string>();
      urls.set(Math.round(currentTime), thumbUrl);
      this.cache.set(task.id, urls);
      this.touchCacheEntry(task.id);
      this.evictCacheIfNeeded();

      framesProcessed++;
      if (!this.isCancelled(task.id)) {
        task.onProgress?.(framesProcessed / totalFrames, thumbUrl, currentTime);
      }
    }

    if (!this.isCancelled(task.id)) {
      task.onComplete?.();
    }
  }

  async clearThumbnails(input: { projectId: string; hash: string }) {
    this.cache.delete(input.hash);

    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    try {
      const dir = await ensureTimelineThumbnailDir({
        projectId: input.projectId,
        workspaceStore,
        create: true,
      });

      await dir.removeEntry(input.hash, { recursive: true });
    } catch (e: unknown) {
      if (!isDomExceptionName(e, 'NotFoundError')) {
        console.warn('Failed to clear thumbnails for', input.hash, e);
      }
    }
  }
}

export const thumbnailGenerator = new ThumbnailGenerator();
