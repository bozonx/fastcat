import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { FILE_MANAGER_THUMBNAILS } from '~/utils/constants';
import { getProjectThumbnailsSegments } from '~/utils/vardata-paths';

export interface FileThumbnailTask {
  id: string; // usually clip hash
  projectId: string;
  projectRelativePath: string;
  onComplete?: (url: string) => void;
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

export function getFileThumbnailHash(input: {
  projectId: string;
  projectRelativePath: string;
}): string {
  return hashString(`file:${input.projectId}:${input.projectRelativePath}`);
}

class FileThumbnailGenerator {
  private queue: FileThumbnailTask[] = [];
  private activeTasks = new Set<string>();
  private cache = new Map<string, string>(); // hash -> blob url
  private readonly maxCacheEntries = 200;
  private cancelledTasks = new Set<string>();

  private touchCacheEntry(id: string) {
    const url = this.cache.get(id);
    if (!url) return;
    this.cache.delete(id);
    this.cache.set(id, url);
  }

  private evictCacheIfNeeded() {
    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) return;
      const url = this.cache.get(oldestKey);
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
      this.cache.delete(oldestKey);
    }
  }

  cancelTask(id: string) {
    if (!id) return;
    this.cancelledTasks.add(id);
    this.queue = this.queue.filter((t) => t.id !== id);
  }

  private isCancelled(id: string) {
    return this.cancelledTasks.has(id);
  }

  addTask(task: FileThumbnailTask) {
    if (this.isCancelled(task.id)) {
      this.cancelledTasks.delete(task.id);
    }
    if (this.queue.some((t) => t.id === task.id) || this.activeTasks.has(task.id)) {
      return;
    }

    if (this.cache.has(task.id)) {
      this.touchCacheEntry(task.id);
      task.onComplete?.(this.cache.get(task.id)!);
      return;
    }

    this.queue.push(task);
    this.processQueue();
  }

  private processQueue() {
    while (
      this.activeTasks.size < FILE_MANAGER_THUMBNAILS.MAX_CONCURRENT_TASKS &&
      this.queue.length > 0
    ) {
      const task = this.queue.shift();
      if (task) {
        this.activeTasks.add(task.id);
        this.generateThumbnail(task).finally(() => {
          this.activeTasks.delete(task.id);
          this.processQueue();
        });
      }
    }
  }

  private async loadThumbnailFromOPFS(task: FileThumbnailTask): Promise<string | null> {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return null;

    try {
      const parts = [
        ...getProjectThumbnailsSegments(task.projectId),
        FILE_MANAGER_THUMBNAILS.DIR_NAME,
      ];

      let dir = workspaceStore.workspaceHandle;
      for (const segment of parts) {
        dir = await dir.getDirectoryHandle(segment);
      }

      const fileName = `${task.id}.webp`;
      const fileHandle = await dir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const url = URL.createObjectURL(file);

      this.cache.set(task.id, url);
      this.touchCacheEntry(task.id);
      this.evictCacheIfNeeded();
      return url;
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        console.warn('Failed to load file thumbnail from OPFS', task.id, e);
      }
      return null;
    }
  }

  private async generateThumbnail(task: FileThumbnailTask): Promise<void> {
    const existingUrl = await this.loadThumbnailFromOPFS(task);
    if (existingUrl) {
      if (!this.isCancelled(task.id)) {
        task.onComplete?.(existingUrl);
      }
      return;
    }

    if (this.isCancelled(task.id)) {
      return;
    }

    return new Promise((resolve, reject) => {
      const workspaceStore = useWorkspaceStore();
      const projectStore = useProjectStore();

      if (!workspaceStore.workspaceHandle) {
        reject(new Error('Workspace is not opened'));
        return;
      }

      // If it's a timeline file, we don't have an automatic generator for it.
      // We expect it to be saved manually during project save.
      if (task.projectRelativePath.toLowerCase().endsWith('.otio')) {
        resolve();
        return;
      }

      const video = document.createElement('video');
      video.muted = true;
      video.crossOrigin = 'anonymous';

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');


      if (!ctx) {
        reject(new Error('Failed to get 2d context'));
        return;
      }

      let sourceObjectUrl: string | null = null;
      let seekedHandler: ((...args: any[]) => void) | null = null;
      let errorHandler: ((...args: any[]) => void) | null = null;
      let loadedDataHandler: ((...args: any[]) => void) | null = null;

      const cleanup = (options?: { revokeSource?: boolean }) => {
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
        const parts = [
          ...getProjectThumbnailsSegments(task.projectId),
          FILE_MANAGER_THUMBNAILS.DIR_NAME,
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

      seekedHandler = async () => {
        if (this.isCancelled(task.id)) {
          cleanup();
          resolve();
          return;
        }
        try {
          let targetWidth = video.videoWidth;
          let targetHeight = video.videoHeight;
          const maxDim = FILE_MANAGER_THUMBNAILS.MAX_SIZE;

          if (targetWidth > maxDim || targetHeight > maxDim) {
            if (targetWidth > targetHeight) {
              targetHeight = Math.round(targetHeight * (maxDim / targetWidth));
              targetWidth = maxDim;
            } else {
              targetWidth = Math.round(targetWidth * (maxDim / targetHeight));
              targetHeight = maxDim;
            }
          }

          canvas.width = targetWidth || maxDim;
          canvas.height = targetHeight || maxDim;

          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          const blob = await new Promise<Blob | null>((res) => {
            canvas.toBlob(res, 'image/webp', FILE_MANAGER_THUMBNAILS.QUALITY);
          });

          if (blob) {
            const dir = await ensureTargetDir();
            const fileName = `${task.id}.webp`;
            const fileHandle = await dir.getFileHandle(fileName, { create: true });
            const writable = await (fileHandle as any).createWritable();
            await writable.write(blob);
            await writable.close();

            const savedFile = await fileHandle.getFile();
            const thumbUrl = URL.createObjectURL(savedFile);

            this.cache.set(task.id, thumbUrl);
            this.touchCacheEntry(task.id);
            this.evictCacheIfNeeded();

            if (!this.isCancelled(task.id)) {
              task.onComplete?.(thumbUrl);
            }
          }
        } catch (e) {
          console.error('Error extracting file thumbnail frame', e);
        }

        cleanup();
        resolve();
      };

      errorHandler = (e: unknown) => {
        if (!this.isCancelled(task.id)) {
          task.onError?.(new Error('Video error'));
        }
        cleanup();
        reject(e);
      };

      loadedDataHandler = () => {
        if (this.isCancelled(task.id)) {
          cleanup();
          resolve();
          return;
        }
        const duration = video.duration;
        if (!isNaN(duration) && duration > 0) {
          video.currentTime = duration * FILE_MANAGER_THUMBNAILS.POSITION_FRACTION;
        } else {
          video.currentTime = 0;
        }
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

  async saveManualThumbnail(input: {
    projectId: string;
    projectRelativePath: string;
    blob: Blob;
  }) {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    const hash = hashString(`file:${input.projectId}:${input.projectRelativePath}`);
    const parts = [
      ...getProjectThumbnailsSegments(input.projectId),
      FILE_MANAGER_THUMBNAILS.DIR_NAME,
    ];

    let dir = workspaceStore.workspaceHandle;
    for (const segment of parts) {
      dir = await dir.getDirectoryHandle(segment, { create: true });
    }

    const fileName = `${hash}.webp`;
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await (fileHandle as any).createWritable();
    await writable.write(input.blob);
    await writable.close();

    // Revoke old URL if exists in cache
    const oldUrl = this.cache.get(hash);
    if (oldUrl) {
      try {
        URL.revokeObjectURL(oldUrl);
      } catch {
        /* ignore */
      }
    }

    const savedFile = await fileHandle.getFile();
    const thumbUrl = URL.createObjectURL(savedFile);

    this.cache.set(hash, thumbUrl);
    this.touchCacheEntry(hash);
    this.evictCacheIfNeeded();
  }

  async clearThumbnail(input: { projectId: string; hash: string }) {
    const url = this.cache.get(input.hash);
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
      this.cache.delete(input.hash);
    }

    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    try {
      const parts = [
        ...getProjectThumbnailsSegments(input.projectId),
        FILE_MANAGER_THUMBNAILS.DIR_NAME,
      ];

      let dir = workspaceStore.workspaceHandle;
      for (const segment of parts) {
        dir = await dir.getDirectoryHandle(segment);
      }

      await dir.removeEntry(`${input.hash}.webp`);
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        console.warn('Failed to clear file thumbnail for', input.hash, e);
      }
    }
  }

  async clearAllThumbnails(projectId: string) {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    try {
      const parts = [...getProjectThumbnailsSegments(projectId), FILE_MANAGER_THUMBNAILS.DIR_NAME];

      let dir = workspaceStore.workspaceHandle;
      for (const segment of parts) {
        dir = await dir.getDirectoryHandle(segment);
      }

      // We just delete the whole folder
      let rootDir = workspaceStore.workspaceHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        rootDir = await rootDir.getDirectoryHandle(parts[i]!);
      }
      await rootDir.removeEntry(FILE_MANAGER_THUMBNAILS.DIR_NAME, { recursive: true });
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        console.warn('Failed to clear all file thumbnails for project', projectId, e);
      }
    }
  }
}

export const fileThumbnailGenerator = new FileThumbnailGenerator();
