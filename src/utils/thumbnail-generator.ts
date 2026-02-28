import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { TIMELINE_CLIP_THUMBNAILS } from '~/utils/constants';
import { getProjectThumbnailsSegments } from '~/utils/vardata-paths';

export interface ThumbnailTask {
  id: string; // usually clip hash
  projectId: string;
  projectRelativePath: string;
  duration: number; // video duration in seconds
  onProgress?: (progress: number, url: string, time: number) => void;
  onComplete?: () => void;
  onError?: (err: Error) => void;
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

export function getClipThumbnailsHash(input: {
  projectId: string;
  projectRelativePath: string;
}): string {
  return hashString(`${input.projectId}:${input.projectRelativePath}`);
}

class ThumbnailGenerator {
  private queue: ThumbnailTask[] = [];
  private activeTasks = new Set<string>();
  private cache = new Map<string, string[]>(); // hash -> array of blob urls

  addTask(task: ThumbnailTask) {
    if (this.queue.some((t) => t.id === task.id) || this.activeTasks.has(task.id)) {
      return; // Already in queue or processing
    }

    // Check if we already generated it
    if (this.cache.has(task.id)) {
      const urls = this.cache.get(task.id)!;
      urls.forEach((url, index) => {
        const time = index * TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS;
        task.onProgress?.((index + 1) / urls.length, url, time);
      });
      task.onComplete?.();
      return;
    }

    this.queue.push(task);
    this.processQueue();
  }

  private processQueue() {
    while (
      this.activeTasks.size < TIMELINE_CLIP_THUMBNAILS.MAX_CONCURRENT_TASKS &&
      this.queue.length > 0
    ) {
      const task = this.queue.shift();
      if (task) {
        this.activeTasks.add(task.id);
        this.generateThumbnails(task).finally(() => {
          this.activeTasks.delete(task.id);
          this.processQueue();
        });
      }
    }
  }

  private async loadThumbnailsFromOPFS(task: ThumbnailTask): Promise<boolean> {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return false;

    try {
      const parts = [
        ...getProjectThumbnailsSegments(task.projectId),
        TIMELINE_CLIP_THUMBNAILS.DIR_NAME,
        task.id,
      ];

      let dir = workspaceStore.workspaceHandle;
      for (const segment of parts) {
        dir = await dir.getDirectoryHandle(segment);
      }

      const hashDir = dir;

      const urls: string[] = [];
      const totalFrames = Math.ceil(task.duration / TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS);
      let framesProcessed = 0;

      // We expect filenames to be "0.webp", "5.webp", "10.webp", etc.
      for (let i = 0; i <= task.duration; i += TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS) {
        const fileName = `${Math.round(i)}.webp`;
        try {
          const fileHandle = await hashDir.getFileHandle(fileName);
          const file = await fileHandle.getFile();
          const url = URL.createObjectURL(file);
          urls.push(url);
          framesProcessed++;
          task.onProgress?.(framesProcessed / totalFrames, url, i);
        } catch (e: any) {
          if (e?.name === 'NotFoundError') {
            // If any frame is missing, we consider OPFS cache incomplete
            return false;
          }
          throw e;
        }
      }

      this.cache.set(task.id, urls);
      task.onComplete?.();
      return true;
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        console.warn('Failed to load thumbnails from OPFS', task.id, e);
      }
      return false;
    }
  }

  private async generateThumbnails(task: ThumbnailTask): Promise<void> {
    const isLoaded = await this.loadThumbnailsFromOPFS(task);
    if (isLoaded) {
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

      const ensureTargetDir = async () => {
        const parts = [
          ...getProjectThumbnailsSegments(task.projectId),
          TIMELINE_CLIP_THUMBNAILS.DIR_NAME,
          task.id,
        ];

        let dir = workspaceStore.workspaceHandle!;
        for (const segment of parts) {
          dir = await dir.getDirectoryHandle(segment, { create: true });
        }
        return dir;
      };

      const ensureSourceUrl = async () => {
        const sourceHandle = await projectStore.getFileHandleByPath(task.projectRelativePath);
        if (!sourceHandle) throw new Error(`Source file not found: ${task.projectRelativePath}`);
        const file = await sourceHandle.getFile();
        sourceObjectUrl = URL.createObjectURL(file);
        video.src = sourceObjectUrl;
      };

      const processNextFrame = async () => {
        if (currentTime > task.duration) {
          task.onComplete?.();
          if (sourceObjectUrl) {
            URL.revokeObjectURL(sourceObjectUrl);
          }
          resolve();
          return;
        }

        video.currentTime = currentTime;
      };

      video.addEventListener('seeked', async () => {
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

            const savedFile = await fileHandle.getFile();
            const thumbUrl = URL.createObjectURL(savedFile);

            const urls = this.cache.get(task.id) ?? [];
            urls.push(thumbUrl);
            this.cache.set(task.id, urls);

            framesProcessed++;
            task.onProgress?.(framesProcessed / totalFrames, thumbUrl, currentTime);
          }
        } catch (e) {
          console.error('Error extracting frame', e);
        }

        currentTime += TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS;

        // Yield to main thread to prevent UI freezing
        setTimeout(processNextFrame, 50);
      });

      video.addEventListener('error', (e) => {
        task.onError?.(new Error('Video error'));
        if (sourceObjectUrl) {
          URL.revokeObjectURL(sourceObjectUrl);
        }
        reject(e);
      });

      (async () => {
        try {
          await ensureSourceUrl();
          video.addEventListener('loadeddata', () => {
            processNextFrame();
          });
          video.load();
        } catch (e: any) {
          task.onError?.(e instanceof Error ? e : new Error(String(e)));
          reject(e);
        }
      })();
    });
  }

  async clearThumbnails(input: { projectId: string; hash: string }) {
    const urls = this.cache.get(input.hash);
    if (urls) {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    }
    this.cache.delete(input.hash);

    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    try {
      const parts = [
        ...getProjectThumbnailsSegments(input.projectId),
        TIMELINE_CLIP_THUMBNAILS.DIR_NAME,
      ];

      let dir = workspaceStore.workspaceHandle;
      for (const segment of parts) {
        dir = await dir.getDirectoryHandle(segment, { create: true });
      }

      await dir.removeEntry(input.hash, { recursive: true });
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        console.warn('Failed to clear thumbnails for', input.hash, e);
      }
    }
  }
}

export const thumbnailGenerator = new ThumbnailGenerator();
