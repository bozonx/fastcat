import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { TIMELINE_CLIP_THUMBNAILS } from '~/utils/constants';
import {
  BaseThumbnailGenerator,
  type BaseThumbnailTask,
  ensureBaseThumbnailDir,
  hashString,
} from './base-thumbnail-generator';

export interface ThumbnailTask extends BaseThumbnailTask {
  duration: number; // video duration in seconds
  onProgress?: (progress: number, url: string, time: number) => void;
  onComplete?: () => void;
  onError?: (err: Error) => void;
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

class ThumbnailGenerator extends BaseThumbnailGenerator<ThumbnailTask, string[]> {
  protected maxCacheEntries = 50;

  protected get concurrencyLimit(): number {
    const workspaceStore = useWorkspaceStore();
    return workspaceStore.userSettings?.optimization?.mediaTaskConcurrency || 2;
  }

  protected revokeCacheValue(urls: string[]): void {
    // Note: URL revocation is now handled by the consumers (components)
    // to avoid UI breaking when cache evicts an actively displayed thumbnail.
    // For now, we do nothing here.
  }

  protected onCacheHit(task: ThumbnailTask, urls: string[]): void {
    urls.forEach((url, index) => {
      const time = index * TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS;
      task.onProgress?.((index + 1) / urls.length, url, time);
    });
    task.onComplete?.();
  }

  private async loadThumbnailsFromOPFS(task: ThumbnailTask): Promise<boolean> {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return false;

    try {
      const hashDir = await ensureTimelineThumbnailDir({
        projectId: task.projectId,
        workspaceStore,
        hash: task.id,
      });

      const urls: string[] = [];
      const totalFrames = Math.ceil(task.duration / TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS);
      let framesProcessed = 0;

      // We expect filenames to be "0.webp", "5.webp", "10.webp", etc.
      for (let i = 0; i <= task.duration; i += TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS) {
        if (this.isCancelled(task.id)) {
          return true; // Cancelled
        }
        const fileName = `${Math.round(i)}.webp`;
        try {
          const fileHandle = await hashDir.getFileHandle(fileName);
          const file = await fileHandle.getFile();
          const buffer = await file.arrayBuffer();
          const blob = new Blob([buffer], { type: file.type });
          const url = URL.createObjectURL(blob);
          urls.push(url);
          framesProcessed++;
          if (!this.isCancelled(task.id)) {
            task.onProgress?.(framesProcessed / totalFrames, url, i);
          }
        } catch (e: any) {
          if (e?.name === 'NotFoundError') {
            // If any frame is missing, we consider OPFS cache incomplete
            return false;
          }
          throw e;
        }
      }

      if (this.isCancelled(task.id)) {
        return true;
      }

      this.cache.set(task.id, urls);
      this.touchCacheEntry(task.id);
      this.evictCacheIfNeeded();
      task.onComplete?.();
      return true;
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        console.warn('Failed to load thumbnails from OPFS', task.id, e);
      }
      return false;
    }
  }

  protected async executeTask(task: ThumbnailTask): Promise<void> {
    const isLoaded = await this.loadThumbnailsFromOPFS(task);
    if (isLoaded) {
      return Promise.resolve();
    }

    if (this.isCancelled(task.id)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const workspaceStore = useWorkspaceStore();
      const projectStore = useProjectStore();

      if (!workspaceStore.workspaceHandle) {
        reject(new Error('Workspace is not opened'));
        return;
      }

      const video = document.createElement('video');
      video.muted = true;
      video.crossOrigin = 'anonymous';

      const canvas = document.createElement('canvas');
      canvas.width = TIMELINE_CLIP_THUMBNAILS.WIDTH;
      canvas.height = TIMELINE_CLIP_THUMBNAILS.HEIGHT;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to get 2d context'));
        return;
      }

      let currentTime = 0;
      const totalFrames = Math.ceil(task.duration / TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS);
      let framesProcessed = 0;

      let sourceObjectUrl: string | null = null;
      let nextFrameTimer: number | null = null;

      let seekedHandler: ((...args: any[]) => void) | null = null;
      let errorHandler: ((...args: any[]) => void) | null = null;
      let loadedDataHandler: ((...args: any[]) => void) | null = null;

      const cleanup = (options?: { revokeSource?: boolean }) => {
        if (nextFrameTimer !== null) {
          clearTimeout(nextFrameTimer);
          nextFrameTimer = null;
        }

        if (seekedHandler) {
          video.removeEventListener('seeked', seekedHandler);
          seekedHandler = null;
        }
        if (errorHandler) {
          video.removeEventListener('error', errorHandler);
          errorHandler = null;
        }
        if (loadedDataHandler) {
          video.removeEventListener('loadeddata', loadedDataHandler);
          loadedDataHandler = null;
        }

        try {
          video.pause();
        } catch {
          // ignore
        }

        try {
          video.removeAttribute('src');
          video.load();
        } catch {
          // ignore
        }

        if (options?.revokeSource !== false && sourceObjectUrl) {
          try {
            URL.revokeObjectURL(sourceObjectUrl);
          } catch {
            // ignore
          }
          sourceObjectUrl = null;
        }
      };

      const ensureTargetDir = async () => {
        return await ensureTimelineThumbnailDir({
          projectId: task.projectId,
          workspaceStore,
          hash: task.id,
          create: true,
        });
      };

      const ensureSourceUrl = async () => {
        const file = await projectStore.getFileByPath(task.projectRelativePath);
        if (!file) throw new Error(`Source file not found: ${task.projectRelativePath}`);
        sourceObjectUrl = URL.createObjectURL(file);
        video.src = sourceObjectUrl;
      };

      const processNextFrame = async () => {
        if (this.isCancelled(task.id)) {
          cleanup();
          resolve();
          return;
        }
        if (currentTime > task.duration) {
          task.onComplete?.();
          cleanup();
          resolve();
          return;
        }

        video.currentTime = currentTime;
      };

      seekedHandler = async () => {
        if (this.isCancelled(task.id)) {
          cleanup();
          resolve();
          return;
        }
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          const blob = await new Promise<Blob | null>((res) => {
            canvas.toBlob(res, 'image/webp', TIMELINE_CLIP_THUMBNAILS.QUALITY);
          });

          if (blob) {
            const dir = await ensureTargetDir();
            const fileName = `${Math.round(currentTime)}.webp`;
            const fileHandle = await dir.getFileHandle(fileName, { create: true });
            const writable = await (fileHandle as any).createWritable();
            await writable.write(blob);
            await writable.close();

            const thumbUrl = URL.createObjectURL(blob);

            const urls = this.cache.get(task.id) ?? [];
            urls.push(thumbUrl);
            this.cache.set(task.id, urls);
            this.touchCacheEntry(task.id);
            this.evictCacheIfNeeded();

            framesProcessed++;
            if (!this.isCancelled(task.id)) {
              task.onProgress?.(framesProcessed / totalFrames, thumbUrl, currentTime);
            }
          }
        } catch (e) {
          console.error('Error extracting frame', e);
        }

        currentTime += TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS;

        // Yield to main thread to prevent UI freezing
        nextFrameTimer = window.setTimeout(() => {
          nextFrameTimer = null;
          void processNextFrame();
        }, 50);
      };

      errorHandler = (e: unknown) => {
        if (!this.isCancelled(task.id)) {
          task.onError?.(new Error('Video error'));
        }
        cleanup();
        reject(e);
      };

      loadedDataHandler = () => {
        void processNextFrame();
      };

      if (seekedHandler) video.addEventListener('seeked', seekedHandler);
      if (errorHandler) video.addEventListener('error', errorHandler);

      (async () => {
        try {
          await ensureSourceUrl();
          if (this.isCancelled(task.id)) {
            cleanup();
            resolve();
            return;
          }
          if (loadedDataHandler) video.addEventListener('loadeddata', loadedDataHandler);
          video.load();
        } catch (e: any) {
          if (!this.isCancelled(task.id)) {
            task.onError?.(e instanceof Error ? e : new Error(String(e)));
          }
          cleanup();
          reject(e);
        }
      })();
    });
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
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        console.warn('Failed to clear thumbnails for', input.hash, e);
      }
    }
  }
}

export const thumbnailGenerator = new ThumbnailGenerator();
