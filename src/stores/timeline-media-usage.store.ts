import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { useProjectStore } from './project.store';
import { useWorkspaceStore } from './workspace.store';
import { useVfs } from '~/composables/useVfs';

import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import { createTimelineDocId } from '~/timeline/id';

import {
  computeMediaUsageByTimelineDocs,
  type MediaPathToTimelinesMap,
} from '~/utils/timeline-media-usage';

interface FsDirectoryHandleWithIteration extends FileSystemDirectoryHandle {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

export class TimelineScanError extends Error {
  constructor(
    public readonly code: 'PROJECT_TOO_LARGE' | 'DIR_UNAVAILABLE' | 'UNKNOWN',
    message: string,
  ) {
    super(message);
    this.name = 'TimelineScanError';
  }
}

export const useTimelineMediaUsageStore = defineStore('timeline-media-usage', () => {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();

  const scannedMediaUsage = ref<MediaPathToTimelinesMap>({});
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const lastScanAt = ref<number | null>(null);

  const liveMediaUsage = ref<MediaPathToTimelinesMap>({});
  const liveTimelinePath = ref<string | null>(null);

  const setLiveUsage = (path: string | null, usage: MediaPathToTimelinesMap) => {
    liveTimelinePath.value = path;
    liveMediaUsage.value = usage;
  };

  const mediaPathToTimelines = computed<MediaPathToTimelinesMap>(() => {
    const combined: MediaPathToTimelinesMap = { ...scannedMediaUsage.value };
    const live = liveMediaUsage.value;
    const currentPath = liveTimelinePath.value;

    // Remove stale disk data for currently opened timeline
    if (currentPath) {
      for (const mediaPath in combined) {
        const refs = combined[mediaPath];
        if (refs) {
          combined[mediaPath] = refs.filter((t) => t.timelinePath !== currentPath);
        }
      }
    }

    // Merge live data
    for (const mediaPath in live) {
      const liveRefs = live[mediaPath];
      if (!liveRefs) continue;

      if (!combined[mediaPath]) {
        combined[mediaPath] = [];
      }

      const existingRefs = combined[mediaPath] || [];
      combined[mediaPath] = [...existingRefs, ...liveRefs];

      // Keep sorted
      combined[mediaPath].sort((a, b) => a.timelineName.localeCompare(b.timelineName));
    }

    // Cleanup empty arrays
    for (const mediaPath in combined) {
      const refs = combined[mediaPath];
      if (!refs || refs.length === 0) {
        delete combined[mediaPath];
      }
    }

    return combined;
  });

  const isReady = computed(() =>
    Boolean(workspaceStore.projectsHandle && projectStore.currentProjectName),
  );

  async function getProjectDirHandle(): Promise<FileSystemDirectoryHandle | null> {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return null;
    try {
      return await workspaceStore.projectsHandle.getDirectoryHandle(
        projectStore.currentProjectName,
      );
    } catch {
      return null;
    }
  }

  async function listTimelineFiles(params: {
    projectDir: FileSystemDirectoryHandle;
    maxEntries?: number;
  }): Promise<string[]> {
    const maxEntries = params.maxEntries ?? 50_000;
    let seen = 0;

    const result: string[] = [];

    const walk = async (dir: FileSystemDirectoryHandle, basePath: string) => {
      const iterator =
        (dir as FsDirectoryHandleWithIteration).values?.() ??
        (dir as FsDirectoryHandleWithIteration).entries?.();
      if (!iterator) return;

      for await (const value of iterator) {
        if (seen >= maxEntries) {
          throw new TimelineScanError('PROJECT_TOO_LARGE', 'Project too large to scan timelines');
        }
        seen += 1;

        const handle = (Array.isArray(value) ? value[1] : value) as
          | FileSystemFileHandle
          | FileSystemDirectoryHandle;

        const fullPath = basePath ? `${basePath}/${handle.name}` : handle.name;

        if (handle.kind === 'directory') {
          await walk(handle as FileSystemDirectoryHandle, fullPath);
          continue;
        }

        if (fullPath.toLowerCase().endsWith('.otio')) {
          result.push(fullPath);
        }
      }
    };

    await walk(params.projectDir, '');

    return result;
  }

  async function readTimelineDocByPath(params: { timelinePath: string }) {
    const vfs = useVfs();
    if (!vfs) {
      console.warn('[TimelineMediaUsage] VFS is not available yet, skipping scan for:', params.timelinePath);
      return null;
    }
    const file = await vfs.getFile(params.timelinePath);
    if (!file) return null;
    const text = await file.text();

    const nameFromPath = params.timelinePath.split('/').pop() ?? params.timelinePath;
    const id = projectStore.currentProjectName
      ? createTimelineDocId(projectStore.currentProjectName)
      : createTimelineDocId('unknown');

    return {
      timelinePath: params.timelinePath,
      timelineName: nameFromPath,
      timelineDoc: parseTimelineFromOtio(text, {
        id,
        name: nameFromPath,
        fps: projectStore.projectSettings.project.fps,
      }),
    };
  }

  async function refreshUsage() {
    if (!isReady.value) {
      scannedMediaUsage.value = {};
      error.value = null;
      lastScanAt.value = null;
      return;
    }

    const projectDir = await getProjectDirHandle();
    if (!projectDir) {
      scannedMediaUsage.value = {};
      error.value = 'Project directory is not available';
      lastScanAt.value = null;
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      const timelinePaths = await listTimelineFiles({ projectDir });

      const timelines = (
        await Promise.all(
          timelinePaths.map(async (timelinePath) => await readTimelineDocByPath({ timelinePath })),
        )
      )
        .filter(Boolean)
        .map((t) => t!);

      scannedMediaUsage.value = computeMediaUsageByTimelineDocs(timelines).mediaPathToTimelines;
      lastScanAt.value = Date.now();
    } catch (e: unknown) {
      console.error('[TimelineMediaUsage] Error scanning timelines:', e);
      scannedMediaUsage.value = {};
      if (e instanceof TimelineScanError) {
        error.value = `Scan failed: ${e.message} (${e.code})`;
      } else {
        error.value = e instanceof Error ? e.message : String(e);
      }
      lastScanAt.value = null;
    } finally {
      isLoading.value = false;
    }
  }

  return {
    mediaPathToTimelines,
    isLoading,
    error,
    lastScanAt,
    refreshUsage,
    setLiveUsage,
  };
});
