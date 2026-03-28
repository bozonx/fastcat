import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { FILE_MANAGER_THUMBNAILS, MARKER_THUMBNAILS, TIMELINE_MANAGER_THUMBNAILS } from '~/utils/constants';
import { ensureResolvedProjectThumbnailsDir, ensureResolvedProjectTempDir } from '~/utils/storage-handles';
import {
  BaseThumbnailGenerator,
  type BaseThumbnailTask,
  hashString,
} from './base-thumbnail-generator';
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';

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
  return (await ensureResolvedProjectThumbnailsDir({
    workspaceHandle: input.workspaceStore.workspaceHandle!,
    topology: input.workspaceStore.resolvedStorageTopology,
    projectId: input.projectId,
    subDir: input.dirName,
    create: input.create,
  })) as FileSystemDirectoryHandle;
}

class FileThumbnailGenerator extends BaseThumbnailGenerator<FileThumbnailTask, string> {
  protected maxCacheEntries = 200;

  protected get taskPriority(): number {
    return MEDIA_TASK_PRIORITIES.fileThumbnail;
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
      const buffer = await file.arrayBuffer();
      const blob = new Blob([buffer], { type: file.type });
      const url = URL.createObjectURL(blob);

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

    if (this.isCancelled(task.id)) return;

    const workspaceStore = useWorkspaceStore();
    const projectStore = useProjectStore();

    if (!workspaceStore.workspaceHandle) {
      throw new Error('Workspace is not opened');
    }

    // If it's a timeline file, we don't have an automatic generator for it.
    // We expect it to be saved manually during project save.
    if (task.projectRelativePath.toLowerCase().endsWith('.otio')) return;

    const file = await projectStore.getFileByPath(task.projectRelativePath);
    if (!file) {
      task.onError?.(new Error(`Source file not found: ${task.projectRelativePath}`));
      return;
    }

    setExportHostApi(
      createVideoCoreHostApi({
        getCurrentProjectId: () => projectStore.currentProjectId,
        getWorkspaceHandle: () => workspaceStore.workspaceHandle,
        getResolvedStorageTopology: () => workspaceStore.resolvedStorageTopology,
        getFileHandleByPath: async (path) => projectStore.getFileHandleByPath(path),
        getFileByPath: async (path) => projectStore.getFileByPath(path),
        onExportProgress: () => {},
      }),
    );

    const { client } = getExportWorkerClient();

    let blob: Blob | null = null;
    try {
      const blobs = await client.extractVideoFrameBlobs(file, {
        timesS: [FILE_MANAGER_THUMBNAILS.POSITION_FRACTION],
        maxWidth: FILE_MANAGER_THUMBNAILS.MAX_SIZE,
        maxHeight: FILE_MANAGER_THUMBNAILS.MAX_SIZE,
        quality: FILE_MANAGER_THUMBNAILS.QUALITY,
        mimeType: 'image/webp',
      });
      blob = blobs[0] ?? null;
    } catch (e: any) {
      if (!this.isCancelled(task.id)) {
        task.onError?.(e instanceof Error ? e : new Error(String(e)));
      }
      return;
    }

    if (!blob || this.isCancelled(task.id)) return;

    const dir = await ensureThumbnailDir({
      projectId: task.projectId,
      dirName: FILE_MANAGER_THUMBNAILS.DIR_NAME,
      workspaceStore,
      create: true,
    });

    const fileName = `${task.id}.webp`;
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await (fileHandle as any).createWritable();
    await writable.write(blob);
    await writable.close();

    const thumbUrl = URL.createObjectURL(blob);

    this.cache.set(task.id, thumbUrl);
    this.touchCacheEntry(task.id);
    this.evictCacheIfNeeded();

    if (!this.isCancelled(task.id)) {
      task.onComplete?.(thumbUrl);
    }
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

    const thumbUrl = URL.createObjectURL(input.blob);

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

  async getMarkerThumbnail(input: {
    projectId: string;
    markerId: string;
    timeUs: number;
  }): Promise<string | null> {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return null;

    const cacheKey = `marker:${input.markerId}`;
    
    try {
      const dir = await ensureThumbnailDir({
        projectId: input.projectId,
        dirName: MARKER_THUMBNAILS.DIR_NAME,
        workspaceStore,
      });

      const prefix = `${input.markerId}_`;
      const expectedFileName = `${prefix}${input.timeUs}.webp`;

      let foundHandle: FileSystemFileHandle | null = null;
      const toDelete: string[] = [];

      for await (const entry of (dir as any).values()) {
        if (entry.kind === 'file' && entry.name.startsWith(prefix)) {
          if (entry.name === expectedFileName) {
            foundHandle = entry;
          } else {
            toDelete.push(entry.name);
          }
        }
      }

      // Cleanup stale files
      for (const name of toDelete) {
        await dir.removeEntry(name).catch(() => {});
      }

      if (foundHandle) {
        const file = await foundHandle.getFile();
        const blob = new Blob([await file.arrayBuffer()], { type: 'image/webp' });
        const url = URL.createObjectURL(blob);
        this.cache.set(cacheKey, url);
        return url;
      }
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        console.warn('Failed to get marker thumbnail from OPFS', input.markerId, e);
      }
    }

    return null;
  }

  async saveMarkerThumbnail(input: {
    projectId: string;
    markerId: string;
    timeUs: number;
    blob: Blob;
  }) {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    try {
      const dir = await ensureThumbnailDir({
        projectId: input.projectId,
        dirName: MARKER_THUMBNAILS.DIR_NAME,
        workspaceStore,
        create: true,
      });

      const fileName = `${input.markerId}_${input.timeUs}.webp`;
      const fileHandle = await dir.getFileHandle(fileName, { create: true });
      const writable = await (fileHandle as any).createWritable();
      await writable.write(input.blob);
      await writable.close();

      const url = URL.createObjectURL(input.blob);
      this.cache.set(`marker:${input.markerId}`, url);
    } catch (e) {
      console.error('Failed to save marker thumbnail to OPFS', input.markerId, e);
    }
  }

  async clearAllThumbnails(projectId: string) {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    try {
      const projectThumbnailsDir = await ensureResolvedProjectThumbnailsDir({
        workspaceHandle: workspaceStore.workspaceHandle,
        topology: workspaceStore.resolvedStorageTopology,
        projectId,
      });

      // Browser FileSystemDirectoryHandle doesn't support recursive delete of the handle itself
      // if we don't have its parent handle. 
      // But we can iterate and delete children.
      for await (const name of (projectThumbnailsDir as any).keys()) {
        await projectThumbnailsDir.removeEntry(name, { recursive: true }).catch(() => {});
      }
      
      // Also clear project-level cache keys
      for (const key of this.cache.keys()) {
        if (key.startsWith(`marker:`) || key.startsWith(`file:${projectId}:`)) {
          this.cache.delete(key);
        }
      }
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        console.warn('Failed to clear all file thumbnails for project', projectId, e);
      }
    }
  }
}

export const fileThumbnailGenerator = new FileThumbnailGenerator();
