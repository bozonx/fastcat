import { markRaw, ref, watch } from 'vue';
import PQueue from 'p-queue';
import { useWorkspaceStore } from '~/stores/workspace.store';

const DEFAULT_MEDIA_TASK_CONCURRENCY = 2;

export const MEDIA_TASK_PRIORITIES = {
  timelineThumbnailLazy: 0,
  proxy: 1,
  conversionBackground: 1,
  fileThumbnail: 2,
  conversionInteractive: 2,
  timelineThumbnail: 3,
} as const;

const mediaTaskQueue = ref(
  markRaw(
    new PQueue({
      concurrency: DEFAULT_MEDIA_TASK_CONCURRENCY,
    }),
  ),
);

let isMediaTaskQueueInitialized = false;

function normalizeConcurrency(value: number | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MEDIA_TASK_CONCURRENCY;
  }

  return Math.max(1, Math.round(parsed));
}

export function getMediaTaskQueue() {
  if (!isMediaTaskQueueInitialized) {
    isMediaTaskQueueInitialized = true;

    const workspaceStore = useWorkspaceStore();

    watch(
      () => workspaceStore.userSettings?.optimization?.mediaTaskConcurrency,
      (value) => {
        mediaTaskQueue.value.concurrency = normalizeConcurrency(value);
      },
      { immediate: true },
    );
  }

  return mediaTaskQueue;
}

export function addMediaTask<T>(
  task: () => Promise<T>,
  options?: {
    priority?: number;
  },
): Promise<T> {
  return getMediaTaskQueue().value.add(task, {
    priority: options?.priority ?? 0,
  });
}
