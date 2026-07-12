import { markRaw, ref } from 'vue';
import PQueue from 'p-queue';
import { isTauriRuntime } from '~/utils/runtime';
import { MEDIA_CONCURRENCY } from '~/utils/constants';

const keyedTaskVersions = new Map<string, number>();

/**
 * Priorities for the **interactive** media-task queue. Higher number = dequeued
 * first (p-queue semantics). Every entry here is a quick, user-visible frame
 * extraction; long-running encodes do NOT belong on this queue — they have their
 * own {@link ENCODE_TASK_PRIORITIES} / {@link addEncodeTask} pool so they can
 * never occupy an interactive slot for the duration of an encode.
 *
 * Ordering (best practice — nearest to what the user is looking at wins):
 *   timelineThumbnail (visible clip strip) > fileThumbnail (browser) > markerThumbnail (lazy).
 */
export const MEDIA_TASK_PRIORITIES = {
  /** Lazy marker-preview stills; lowest — they are off to the side. */
  markerThumbnail: 0,
  /** File-browser grid thumbnails. */
  fileThumbnail: 1,
  /** Thumbnails on visible timeline clips — the most directly user-facing. */
  timelineThumbnail: 2,
} as const;

/**
 * Priorities for the **encode** queue (proxy, conversion). The queue runs a
 * single job at a time, so this only breaks ties between a queued proxy and a
 * queued conversion: an explicit user conversion is ordered ahead of an
 * automatic proxy optimization.
 */
export const ENCODE_TASK_PRIORITIES = {
  proxy: 0,
  conversion: 1,
} as const;

const mediaTaskQueue = ref(
  markRaw(
    new PQueue({
      concurrency: resolveInteractiveConcurrency(),
    }),
  ),
);

const encodeTaskQueue = ref(
  markRaw(
    new PQueue({
      concurrency: resolveEncodeConcurrency(),
    }),
  ),
);

function resolveInteractiveConcurrency(): number {
  return isTauriRuntime()
    ? MEDIA_CONCURRENCY.interactiveTasks.native
    : MEDIA_CONCURRENCY.interactiveTasks.web;
}

function resolveEncodeConcurrency(): number {
  return isTauriRuntime()
    ? MEDIA_CONCURRENCY.encodeTasks.native
    : MEDIA_CONCURRENCY.encodeTasks.web;
}

export function getMediaTaskQueue() {
  return mediaTaskQueue;
}

/**
 * Queue for long-running background encodes (proxy generation, media
 * conversion). Separate from {@link getMediaTaskQueue} so a multi-minute encode
 * can never hold an interactive thumbnail slot hostage.
 */
export function getEncodeTaskQueue() {
  return encodeTaskQueue;
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

/** Enqueue a long-running encode on the dedicated (serial) encode pool. */
export function addEncodeTask<T>(
  task: () => Promise<T>,
  options?: {
    priority?: number;
    signal?: AbortSignal;
  },
): Promise<T> {
  return getEncodeTaskQueue().value.add(task, {
    priority: options?.priority ?? 0,
    signal: options?.signal,
  });
}

/**
 * Test-only helper: clear pending tasks, the keyed-task version map, and reset
 * the queue concurrency so specs can exercise pending-task behaviour deterministically.
 */
export function __resetMediaTaskQueueForTesting(concurrency = resolveInteractiveConcurrency()): void {
  mediaTaskQueue.value.clear();
  mediaTaskQueue.value.concurrency = concurrency;
  keyedTaskVersions.clear();
}

/** Test-only helper mirroring {@link __resetMediaTaskQueueForTesting} for the encode pool. */
export function __resetEncodeTaskQueueForTesting(concurrency = resolveEncodeConcurrency()): void {
  encodeTaskQueue.value.clear();
  encodeTaskQueue.value.concurrency = concurrency;
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
