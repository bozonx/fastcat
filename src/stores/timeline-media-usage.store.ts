import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

import { useProjectStore } from './project.store';
import { useWorkspaceStore } from './workspace.store';

import { parseTimelineFromOtio } from '~/timeline/otioSerializer';
import { createTimelineDocId } from '~/timeline/id';

import {
  computeMediaUsageByTimelineDocs,
  type MediaPathToTimelinesMap,
} from '~/utils/timeline-media-usage';

interface FsDirectoryHandleWithIteration extends FileSystemDirectoryHandle {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

export const useTimelineMediaUsageStore = defineStore('timeline-media-usage', () => {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();

  const mediaPathToTimelines = ref<MediaPathToTimelinesMap>({});
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const lastScanAt = ref<number | null>(null);

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
          throw new Error('Project too large to scan timelines');
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
    const handle = await projectStore.getFileHandleByPath(params.timelinePath);
    if (!handle) return null;

    const file = await handle.getFile();
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
      mediaPathToTimelines.value = {};
      error.value = null;
      lastScanAt.value = null;
      return;
    }

    const projectDir = await getProjectDirHandle();
    if (!projectDir) {
      mediaPathToTimelines.value = {};
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

      mediaPathToTimelines.value = computeMediaUsageByTimelineDocs(timelines).mediaPathToTimelines;
      lastScanAt.value = Date.now();
    } catch (e: any) {
      mediaPathToTimelines.value = {};
      error.value = String(e?.message ?? e);
      lastScanAt.value = null;
    } finally {
      isLoading.value = false;
    }
  }

  watch(
    () => projectStore.currentProjectName,
    () => {
      void refreshUsage();
    },
  );

  return {
    mediaPathToTimelines,
    isLoading,
    error,
    lastScanAt,
    refreshUsage,
  };
});
