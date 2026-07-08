import { markRaw, ref } from 'vue';
import PQueue from 'p-queue';
import { isTauriRuntime } from '~/utils/runtime';

const BROWSER_MEDIA_TASK_CONCURRENCY = 2;
const TAURI_BACKGROUND_MEDIA_TASK_CONCURRENCY = 3;
const keyedTaskVersions = new Map<string, number>();

export const MEDIA_TASK_PRIORITIES = {
  timelineThumbnailLazy: 0,
  proxy: 1,
  conversionBackground: 1,
  fileThumbnail: 2,
  timelineThumbnail: 3,
} as const;

const mediaTaskQueue = ref(
  markRaw(
    new PQueue({
      concurrency: resolveMediaTaskConcurrency(),
    }),
  ),
);

function resolveMediaTaskConcurrency(): number {
  return isTauriRuntime()
    ? TAURI_BACKGROUND_MEDIA_TASK_CONCURRENCY
    : BROWSER_MEDIA_TASK_CONCURRENCY;
}

export function getMediaTaskQueue() {
  return mediaTaskQueue;
}

export function addMediaTask<T>(
  task: () => Promise<T>,
  options?: {
    priority?: number;
    signal?: AbortSignal;
  },
): Promise<T> {
  return getMediaTaskQueue().value.add(task, {
    priority: options?.priority ?? 0,
    signal: options?.signal,
  });
}

/**
 * Test-only helper: clear pending tasks, the keyed-task version map, and reset
 * the queue concurrency so specs can exercise pending-task behaviour deterministically.
 */
export function __resetMediaTaskQueueForTesting(concurrency = resolveMediaTaskConcurrency()): void {
  mediaTaskQueue.value.clear();
  mediaTaskQueue.value.concurrency = concurrency;
  keyedTaskVersions.clear();
}

export function addLatestMediaTask(input: {
  key: string;
  task: () => Promise<void>;
  priority?: number;
}): void {
  const nextVersion = (keyedTaskVersions.get(input.key) ?? 0) + 1;
  keyedTaskVersions.set(input.key, nextVersion);

  void addMediaTask(
    async () => {
      const currentVersion = keyedTaskVersions.get(input.key);
      if (currentVersion !== nextVersion) {
        return;
      }

      try {
        await input.task();
      } finally {
        if (keyedTaskVersions.get(input.key) === nextVersion) {
          keyedTaskVersions.delete(input.key);
        }
      }
    },
    { priority: input.priority },
  );
}
