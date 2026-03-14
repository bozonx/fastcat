import type { useWorkspaceStore } from '~/stores/workspace.store';
import { ensureResolvedProjectTempDir } from '~/utils/storage-handles';

export interface BaseThumbnailTask {
  id: string;
  projectId: string;
  projectRelativePath: string;
}

export function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

export async function ensureBaseThumbnailDir(input: {
  projectId: string;
  leafSegments: string[];
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  create?: boolean;
}): Promise<FileSystemDirectoryHandle> {
  return (await ensureResolvedProjectTempDir({
    workspaceHandle: input.workspaceStore.workspaceHandle!,
    topology: input.workspaceStore.resolvedStorageTopology,
    projectId: input.projectId,
    leafSegments: input.leafSegments,
    create: input.create,
  })) as FileSystemDirectoryHandle;
}

export abstract class BaseThumbnailGenerator<TTask extends BaseThumbnailTask, TCache> {
  protected queue: TTask[] = [];
  protected activeTasks = new Set<string>();
  protected cancelledTasks = new Set<string>();
  protected cache = new Map<string, TCache>();
  protected abstract maxCacheEntries: number;

  protected touchCacheEntry(id: string) {
    const value = this.cache.get(id);
    if (!value) return;
    this.cache.delete(id);
    this.cache.set(id, value);
  }

  protected evictCacheIfNeeded() {
    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) return;
      const value = this.cache.get(oldestKey);
      if (value) {
        this.revokeCacheValue(value);
      }
      this.cache.delete(oldestKey);
    }
  }

  protected abstract revokeCacheValue(value: TCache): void;

  cancelTask(id: string) {
    if (!id) return;
    this.cancelledTasks.add(id);
    this.queue = this.queue.filter((t) => t.id !== id);
  }

  protected isCancelled(id: string) {
    return this.cancelledTasks.has(id);
  }

  addTask(task: TTask) {
    if (this.isCancelled(task.id)) {
      this.cancelledTasks.delete(task.id);
    }
    if (this.queue.some((t) => t.id === task.id) || this.activeTasks.has(task.id)) {
      return;
    }

    if (this.cache.has(task.id)) {
      this.touchCacheEntry(task.id);
      this.onCacheHit(task, this.cache.get(task.id)!);
      return;
    }

    this.queue.push(task);
    this.processQueue();
  }

  protected abstract get concurrencyLimit(): number;
  protected abstract executeTask(task: TTask): Promise<void>;
  protected abstract onCacheHit(task: TTask, cachedValue: TCache): void;

  protected processQueue() {
    while (this.activeTasks.size < this.concurrencyLimit && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        this.activeTasks.add(task.id);
        this.executeTask(task)
          .catch((e) => {
            console.error(`Task ${task.id} failed:`, e);
          })
          .finally(() => {
            this.activeTasks.delete(task.id);
            this.processQueue();
          });
      }
    }
  }
}
