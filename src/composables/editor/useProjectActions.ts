import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';

export function useProjectActions() {
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();
  const mediaStore = useMediaStore();
  const uiStore = useUiStore();
  const focusStore = useFocusStore();

  /**
   * Completely closes the current project and resets all related stores
   */
  function leaveProject() {
    timelineStore.resetTimelineState();
    mediaStore.resetMediaState();
    projectStore.closeProject();
  }

  /**
   * Loads a specific timeline file and handles all side effects
   */
  async function loadTimeline(path: string) {
    if (!projectStore.currentProjectName) return;
    
    // 1. Update project store state
    await projectStore.openTimelineFile(path);
    
    // 2. Sync focus
    focusStore.setActiveTimelinePath(path);
    
    // 3. Load actual data
    await timelineStore.loadTimeline();
    void timelineStore.loadTimelineMetadata();
  }

  /**
   * Opens a project by name and restores its last state
   */
  async function openProject(name: string) {
    leaveProject();
    
    await projectStore.openProject(name);
    uiStore.restoreFileTreeStateOnce(name);
    
    // Project store's openProject already sets currentTimelinePath to lastOpened or default
    if (projectStore.currentTimelinePath) {
      await loadTimeline(projectStore.currentTimelinePath);
    }
  }

  return {
    leaveProject,
    loadTimeline,
    openProject,
  };
}
