import type { Ref } from 'vue';
import type { WorkerVideoPayloadItem } from '~/composables/timeline/export/types';
import type { WorkerTimelineClip } from './types';

export interface MonitorLayoutQueuePayload {
  layoutClips: WorkerTimelineClip[];
  layoutAudioClips: WorkerTimelineClip[];
  workerTimelinePayload?: Ref<WorkerVideoPayloadItem[]>;
}

export interface CreateMonitorCoreQueuesOptions {
  buildDebounceMs: number;
  layoutDebounceMs: number;
  isUnmounted: () => boolean;
  flushBuild: () => Promise<void>;
  flushLayoutUpdate: (payload: MonitorLayoutQueuePayload) => Promise<void>;
}

export function createMonitorCoreQueues(options: CreateMonitorCoreQueuesOptions) {
  let buildInFlight = false;
  let buildRequested = false;
  let buildDebounceTimer: number | null = null;
  let layoutDebounceTimer: number | null = null;
  let layoutScheduledFireAt = Number.POSITIVE_INFINITY;
  let layoutUpdateInFlight = false;
  let pendingLayoutPayload: MonitorLayoutQueuePayload | null = null;

  async function flushBuildQueue() {
    if (buildInFlight) {
      return;
    }

    buildInFlight = true;
    try {
      while (buildRequested && !options.isUnmounted()) {
        buildRequested = false;
        await options.flushBuild();
      }
    } finally {
      buildInFlight = false;
    }
  }

  async function flushLayoutUpdateQueue() {
    if (layoutUpdateInFlight || options.isUnmounted()) {
      return;
    }

    layoutUpdateInFlight = true;
    try {
      while (pendingLayoutPayload) {
        const payload = pendingLayoutPayload;
        pendingLayoutPayload = null;
        await options.flushLayoutUpdate(payload);
      }
    } finally {
      layoutUpdateInFlight = false;
    }
  }

  function scheduleBuild() {
    if (buildDebounceTimer !== null) {
      clearTimeout(buildDebounceTimer);
    }

    buildDebounceTimer = window.setTimeout(() => {
      buildDebounceTimer = null;
      buildRequested = true;
      void flushBuildQueue();
    }, options.buildDebounceMs);
  }

  function scheduleLayoutUpdate(payload: MonitorLayoutQueuePayload, debounceMs?: number) {
    pendingLayoutPayload = payload;

    const delay = debounceMs ?? options.layoutDebounceMs;
    const fireAt = Date.now() + delay;

    // Earliest deadline wins: a pending short (numeric) debounce must not be
    // pushed out by a later long (text) one, but a later short one can pull a
    // pending long one forward.
    if (layoutDebounceTimer !== null && fireAt >= layoutScheduledFireAt) {
      return;
    }

    if (layoutDebounceTimer !== null) {
      clearTimeout(layoutDebounceTimer);
    }

    layoutScheduledFireAt = fireAt;
    layoutDebounceTimer = window.setTimeout(() => {
      layoutDebounceTimer = null;
      layoutScheduledFireAt = Number.POSITIVE_INFINITY;
      void flushLayoutUpdateQueue();
    }, delay);
  }

  function clear() {
    if (buildDebounceTimer !== null) {
      clearTimeout(buildDebounceTimer);
      buildDebounceTimer = null;
    }

    if (layoutDebounceTimer !== null) {
      clearTimeout(layoutDebounceTimer);
      layoutDebounceTimer = null;
    }
    layoutScheduledFireAt = Number.POSITIVE_INFINITY;

    pendingLayoutPayload = null;
    buildRequested = false;
  }

  return {
    clear,
    flushBuildQueue,
    flushLayoutUpdateQueue,
    scheduleBuild,
    scheduleLayoutUpdate,
  };
}
