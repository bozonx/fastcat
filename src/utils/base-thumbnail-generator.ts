import { createDevLogger } from '~/utils/dev-logger';
import { addMediaTask } from '~/utils/media-task-queue';
const log = createDevLogger('base-thumbnail-generator');

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

export abstract class BaseThumbnailGenerator<TTask extends BaseThumbnailTask, TCache> {
  protected queuedTasks = new Set<string>();
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
    // Only mark cancelled if there is in-flight work to cancel; otherwise the
    // marker would leak (cancelTask called for ids that never re-enter addTask).
    if (this.queuedTasks.has(id) || this.activeTasks.has(id)) {
      this.cancelledTasks.add(id);
    }
    this.queuedTasks.delete(id);
  }

  protected isCancelled(id: string) {
    return this.cancelledTasks.has(id);
  }

  addTask(task: TTask) {
    if (this.isCancelled(task.id)) {
      this.cancelledTasks.delete(task.id);
    }
    if (this.queuedTasks.has(task.id) || this.activeTasks.has(task.id)) {
      return;
    }

    if (this.cache.has(task.id)) {
      this.touchCacheEntry(task.id);
      this.onCacheHit(task, this.cache.get(task.id)!);
      return;
    }

    this.queuedTasks.add(task.id);

    void addMediaTask(
      async () => {
        this.queuedTasks.delete(task.id);

        if (this.isCancelled(task.id)) {
          this.cancelledTasks.delete(task.id);
          return;
        }

        this.activeTasks.add(task.id);

        try {
          await this.executeTask(task);
        } catch (e) {
          log.error(`Task ${task.id} failed:`, e);
        } finally {
          this.activeTasks.delete(task.id);
          this.cancelledTasks.delete(task.id);
        }
      },
      { priority: this.taskPriority },
    ).catch((e) => {
      this.queuedTasks.delete(task.id);
      this.cancelledTasks.delete(task.id);
      log.error(`Task ${task.id} failed:`, e);
    });
  }

  protected abstract get taskPriority(): number;
  protected abstract executeTask(task: TTask): Promise<void>;
  protected abstract onCacheHit(task: TTask, cachedValue: TCache): void;

  /**
   * Revoke every cached object URL and drop all in-memory state.
   *
   * The app uses a single module-level instance of each generator, so its
   * cache/queues persist across Vitest specs. Tests call `reset()` in
   * `beforeEach` to get a clean slate without re-importing the module (which
   * would leave the previous instance's blob URLs leaked).
   */
  reset(): void {
    for (const value of this.cache.values()) {
      this.revokeCacheValue(value);
    }
    this.cache.clear();
    this.queuedTasks.clear();
    this.activeTasks.clear();
    this.cancelledTasks.clear();
    this.clearAdditionalState();
  }

  /** Hook for subclasses to clear their own bookkeeping maps in {@link reset}. */
  protected clearAdditionalState(): void {}
}
