import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { FILE_MANAGER_THUMBNAILS, TIMELINE_MANAGER_THUMBNAILS } from '~/utils/constants';
import { ensureResolvedProjectTempDir } from '~/utils/storage-handles';
import {
  BaseThumbnailGenerator,
  type BaseThumbnailTask,
  ensureBaseThumbnailDir,
  hashString,
} from './base-thumbnail-generator';

export interface FileThumbnailTask extends BaseThumbnailTask {
  onComplete?: (url: string) => void;
  onError?: (err: Error) => void;
}

export function getFileThumbnailHash(input: {
  projectId: string;
  projectRelativePath: string;
}): string {
  return hashString(`file:${input.projectId}:${input.projectRelativePath}`);
}

async function ensureThumbnailDir(input: {
  projectId: string;
  dirName: string;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  create?: boolean;
}): Promise<FileSystemDirectoryHandle> {
  return await ensureBaseThumbnailDir({
    projectId: input.projectId,
    workspaceStore: input.workspaceStore,
    leafSegments: ['thumbnails', input.dirName],
    create: input.create,
  });
}

class FileThumbnailGenerator extends BaseThumbnailGenerator<FileThumbnailTask, string> {
  protected maxCacheEntries = 200;

  protected get concurrencyLimit(): number {
    const workspaceStore = useWorkspaceStore();
    return workspaceStore.userSettings.optimization.mediaTaskConcurrency;
  }

  protected revokeCacheValue(url: string): void {
    // Note: URL revocation is now handled by the consumers (components)
  }

  protected onCacheHit(task: FileThumbnailTask, url: string): void {
    task.onComplete?.(url);
  }

  private async loadThumbnailFromOPFS(task: FileThumbnailTask): Promise<string | null> {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return null;

    try {
      const isTimeline = task.projectRelativePath.toLowerCase().endsWith('.otio');
      const dirName = isTimeline
        ? TIMELINE_MANAGER_THUMBNAILS.DIR_NAME
        : FILE_MANAGER_THUMBNAILS.DIR_NAME;

      const dir = await ensureThumbnailDir({
        projectId: task.projectId,
        dirName,
        workspaceStore,
      });

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

  protected async executeTask(task: FileThumbnailTask): Promise<void> {
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
        return await ensureThumbnailDir({
          projectId: task.projectId,
          dirName: FILE_MANAGER_THUMBNAILS.DIR_NAME,
          workspaceStore,
          create: true,
        });
      };

      const ensureSourceUrl = async () => {
        const file = await projectStore.getFileByPath(task.projectRelativePath);
        if (!file) throw new Error(`Source file not found: ${task.projectRelativePath}`);
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

  async saveManualThumbnail(input: { projectId: string; projectRelativePath: string; blob: Blob }) {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    const hash = hashString(`file:${input.projectId}:${input.projectRelativePath}`);
    const isTimeline = input.projectRelativePath.toLowerCase().endsWith('.otio');
    const dirName = isTimeline
      ? TIMELINE_MANAGER_THUMBNAILS.DIR_NAME
      : FILE_MANAGER_THUMBNAILS.DIR_NAME;

    const dir = await ensureThumbnailDir({
      projectId: input.projectId,
      dirName,
      workspaceStore,
      create: true,
    });

    const fileName = `${hash}.webp`;
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await (fileHandle as any).createWritable();
    await writable.write(input.blob);
    await writable.close();

    const savedFile = await fileHandle.getFile();
    const thumbUrl = URL.createObjectURL(savedFile);

    this.cache.set(hash, thumbUrl);
    this.touchCacheEntry(hash);
    this.evictCacheIfNeeded();
  }

  async clearThumbnail(input: { projectId: string; projectRelativePath: string }) {
    const hash = hashString(`file:${input.projectId}:${input.projectRelativePath}`);
    this.cache.delete(hash);

    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    try {
      const isTimeline = input.projectRelativePath.toLowerCase().endsWith('.otio');
      const dirName = isTimeline
        ? TIMELINE_MANAGER_THUMBNAILS.DIR_NAME
        : FILE_MANAGER_THUMBNAILS.DIR_NAME;

      const dir = await ensureThumbnailDir({
        projectId: input.projectId,
        dirName,
        workspaceStore,
      });

      await dir.removeEntry(`${hash}.webp`);
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        console.warn('Failed to clear file thumbnail for', hash, e);
      }
    }
  }

  async clearAllThumbnails(projectId: string) {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    try {
      const dir = await ensureResolvedProjectTempDir({
        workspaceHandle: workspaceStore.workspaceHandle,
        topology: workspaceStore.resolvedStorageTopology,
        projectId,
        leafSegments: ['thumbnails'],
      });

      try {
        await dir.removeEntry(FILE_MANAGER_THUMBNAILS.DIR_NAME, { recursive: true });
      } catch {
        /* ignore */
      }

      try {
        await dir.removeEntry(TIMELINE_MANAGER_THUMBNAILS.DIR_NAME, { recursive: true });
      } catch {
        /* ignore */
      }
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        console.warn('Failed to clear all file thumbnails for project', projectId, e);
      }
    }
  }
}

export const fileThumbnailGenerator = new FileThumbnailGenerator();
