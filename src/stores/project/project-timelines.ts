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
  saveProjectMeta: (updates: Record<string, unknown>) => Promise<void>;
  setWorkspaceError: (message: string | null) => void;
  /**
   * Called after the active timeline changes as a side effect of closing or
   * reordering tabs (which, unlike `selectTab`, don't reload the document
   * themselves). Lets the owner load the now-active timeline — or reset the
   * editor when the last tab was closed (path becomes `null`).
   */
  onActiveTimelineChanged?: () => Promise<void> | void;
  /** Flushes the active automatic-save snapshot before its tab is discarded. */
  beforeActiveTimelineClose?: () => Promise<void> | void;
}) {
  async function openTimelineFile(path: string) {
    if (!params.currentProjectName.value) {
      params.setWorkspaceError('Project is not opened');
      return;
    }

    const normalizedPath = params.toProjectRelativePath(path);
    if (!normalizedPath.toLowerCase().endsWith('.otio')) return;

    // Already the active timeline — re-activating it would only re-push the
    // (deduped) open path and fire a redundant meta write. Document loading is
    // handled separately by the timeline store, so there is nothing to do here.
    // This collapses the open-project flow's double `openTimelineFile` call.
    if (params.currentTimelinePath.value === normalizedPath) return;

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

    const closingActiveTimeline = params.currentTimelinePath.value === path;
    if (closingActiveTimeline) await params.beforeActiveTimelineClose?.();

    const previousPaths = [...params.projectSettings.value.timelines.openPaths];
    params.projectSettings.value.timelines.openPaths.splice(index, 1);

    if (closingActiveTimeline) {
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

      // The active tab was closed: load the newly-active timeline (or reset the
      // editor when no tabs remain).
      await params.onActiveTimelineChanged?.();
    }
  }

  async function closeOtherTimelineFiles(path: string) {
    const hasPath = params.projectSettings.value.timelines.openPaths.includes(path);
    if (!hasPath) return;

    if (params.currentTimelinePath.value !== path) await params.beforeActiveTimelineClose?.();
    params.projectSettings.value.timelines.openPaths = [path];

    if (params.currentTimelinePath.value !== path) {
      await openTimelineFile(path);
      await params.onActiveTimelineChanged?.();
      return;
    }

    params.currentFileName.value = path.split('/').pop() ?? path;
    void params.saveProjectMeta({ lastOpenedTimelinePath: path });
  }

  async function closeAllTimelineFiles() {
    await params.beforeActiveTimelineClose?.();
    params.projectSettings.value.timelines.openPaths = [];
    params.currentTimelinePath.value = null;
    params.currentFileName.value = null;
    void params.saveProjectMeta({ lastOpenedTimelinePath: null });
    await params.onActiveTimelineChanged?.();
  }

  function reorderTimelines(paths: string[]) {
    params.projectSettings.value.timelines.openPaths = paths;

    // Meta is updated via openTimelineFile if current path invalid

    if (params.currentTimelinePath.value && !paths.includes(params.currentTimelinePath.value)) {
      void (async () => {
        await openTimelineFile(paths[0] ?? `${TIMELINES_DIR_NAME}/unknown_001.otio`);
        await params.onActiveTimelineChanged?.();
      })();
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
