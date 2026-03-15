import type { WorkerTimelineClip } from './types';

export interface MonitorLayoutQueuePayload {
  layoutClips: WorkerTimelineClip[];
  layoutAudioClips: WorkerTimelineClip[];
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

  function scheduleLayoutUpdate(payload: MonitorLayoutQueuePayload) {
    pendingLayoutPayload = payload;
    if (layoutDebounceTimer !== null) {
      clearTimeout(layoutDebounceTimer);
    }

    layoutDebounceTimer = window.setTimeout(() => {
      layoutDebounceTimer = null;
      void flushLayoutUpdateQueue();
    }, options.layoutDebounceMs);
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
