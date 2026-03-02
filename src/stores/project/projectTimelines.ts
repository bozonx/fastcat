import type { Ref } from 'vue';

import { TIMELINES_DIR_NAME } from '~/utils/constants';
import type { GranVideoEditorProjectSettings } from '~/utils/project-settings';

export interface ProjectTimelinesModule {
  openTimelineFile: (path: string) => Promise<void>;
  closeTimelineFile: (path: string) => Promise<void>;
  reorderTimelines: (paths: string[]) => void;
}

export function createProjectTimelinesModule(params: {
  currentProjectName: Ref<string | null>;
  currentTimelinePath: Ref<string | null>;
  currentFileName: Ref<string | null>;
  projectSettings: Ref<GranVideoEditorProjectSettings>;
  toProjectRelativePath: (path: string) => string;
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

    params.projectSettings.value.timelines.lastOpenedPath = normalizedPath;

    params.currentTimelinePath.value = normalizedPath;
    params.currentFileName.value = normalizedPath.split('/').pop() ?? normalizedPath;
  }

  async function closeTimelineFile(path: string) {
    const index = params.projectSettings.value.timelines.openPaths.indexOf(path);
    if (index === -1) return;

    params.projectSettings.value.timelines.openPaths.splice(index, 1);

    if (params.currentTimelinePath.value === path) {
      const nextPath = params.projectSettings.value.timelines.openPaths[0] || null;
      if (nextPath) {
        await openTimelineFile(nextPath);
      } else {
        params.currentTimelinePath.value = null;
        params.currentFileName.value = null;
      }
    }
  }

  function reorderTimelines(paths: string[]) {
    params.projectSettings.value.timelines.openPaths = paths;

    const lastOpened = params.projectSettings.value.timelines.lastOpenedPath;
    if (lastOpened && !paths.includes(lastOpened)) {
      params.projectSettings.value.timelines.lastOpenedPath = paths[0] ?? null;
    }

    if (params.currentTimelinePath.value && !paths.includes(params.currentTimelinePath.value)) {
      void openTimelineFile(paths[0] ?? `${TIMELINES_DIR_NAME}/unknown_001.otio`);
    }
  }

  const module: ProjectTimelinesModule = {
    openTimelineFile,
    closeTimelineFile,
    reorderTimelines,
  };

  return module;
}
