import type { Ref } from 'vue';

import { TIMELINES_DIR_NAME } from '~/utils/constants';
import type { FastCatProjectSettings } from '~/utils/project-settings';

export interface ProjectTimelinesModule {
  openTimelineFile: (path: string) => Promise<void>;
  closeTimelineFile: (path: string) => Promise<void>;
  reorderTimelines: (paths: string[]) => void;
  closeOtherTimelineFiles: (path: string) => Promise<void>;
  closeAllTimelineFiles: () => Promise<void>;
}

export function createProjectTimelinesModule(params: {
  currentProjectName: Ref<string | null>;
  currentTimelinePath: Ref<string | null>;
  currentFileName: Ref<string | null>;
  projectSettings: Ref<FastCatProjectSettings>;
  toProjectRelativePath: (path: string) => string;
  saveProjectMeta: (updates: any) => Promise<void>;
  setWorkspaceError: (message: string | null) => void;
}) {
  async function openTimelineFile(path: string) {
    if (!params.currentProjectName.value) {
      params.setWorkspaceError('Project is not opened');
      return;
    }

    const normalizedPath = params.toProjectRelativePath(path);
    if (!normalizedPath.toLowerCase().endsWith('.otio')) return;

    if (!params.projectSettings.value.timelines.openPaths.includes(normalizedPath)) {
      params.projectSettings.value.timelines.openPaths.push(normalizedPath);
    }

    void params.saveProjectMeta({ lastOpenedTimelinePath: normalizedPath });

    params.currentTimelinePath.value = normalizedPath;
    params.currentFileName.value = normalizedPath.split('/').pop() ?? normalizedPath;
  }

  async function closeTimelineFile(path: string) {
    const index = params.projectSettings.value.timelines.openPaths.indexOf(path);
    if (index === -1) return;

    const previousPaths = [...params.projectSettings.value.timelines.openPaths];
    params.projectSettings.value.timelines.openPaths.splice(index, 1);

    if (params.currentTimelinePath.value === path) {
      const nextPath =
        params.projectSettings.value.timelines.openPaths[index] ??
        params.projectSettings.value.timelines.openPaths[index - 1] ??
        previousPaths[index + 1] ??
        null;

      if (nextPath) {
        await openTimelineFile(nextPath);
      } else {
        params.currentTimelinePath.value = null;
        params.currentFileName.value = null;
      }
    }
  }

  async function closeOtherTimelineFiles(path: string) {
    const hasPath = params.projectSettings.value.timelines.openPaths.includes(path);
    if (!hasPath) return;

    params.projectSettings.value.timelines.openPaths = [path];

    if (params.currentTimelinePath.value !== path) {
      await openTimelineFile(path);
      return;
    }

    params.currentFileName.value = path.split('/').pop() ?? path;
    void params.saveProjectMeta({ lastOpenedTimelinePath: path });
  }

  async function closeAllTimelineFiles() {
    params.projectSettings.value.timelines.openPaths = [];
    params.currentTimelinePath.value = null;
    params.currentFileName.value = null;
    void params.saveProjectMeta({ lastOpenedTimelinePath: null });
  }

  function reorderTimelines(paths: string[]) {
    params.projectSettings.value.timelines.openPaths = paths;

    // Meta is updated via openTimelineFile if current path invalid

    if (params.currentTimelinePath.value && !paths.includes(params.currentTimelinePath.value)) {
      void openTimelineFile(paths[0] ?? `${TIMELINES_DIR_NAME}/unknown_001.otio`);
    }
  }

  const module: ProjectTimelinesModule = {
    openTimelineFile,
    closeTimelineFile,
    reorderTimelines,
    closeOtherTimelineFiles,
    closeAllTimelineFiles,
  };

  return module;
}
