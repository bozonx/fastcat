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
  const toast = useToast();

  function resetProjectState() {
    timelineStore.resetTimelineState();
    mediaStore.resetMediaState();
    projectStore.closeProject();
  }

  async function leaveProject() {
    try {
      resetProjectState();
      await navigateTo('/');
    } catch (e) {
      toast.add({
        color: 'red',
        title: 'Failed to leave project',
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function loadTimeline(path: string) {
    if (!projectStore.currentProjectName) return;

    try {
      await projectStore.openTimelineFile(path);
      focusStore.setActiveTimelinePath(path);
      await timelineStore.loadTimeline();
      void timelineStore.loadTimelineMetadata();
    } catch (e) {
      toast.add({
        color: 'red',
        title: 'Failed to load timeline',
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function openProject(name: string) {
    try {
      resetProjectState();
      await projectStore.openProject(name);
      uiStore.restoreFileTreeStateOnce(name);

      if (projectStore.currentTimelinePath) {
        await loadTimeline(projectStore.currentTimelinePath);
      }
    } catch (e) {
      toast.add({
        color: 'red',
        title: 'Failed to open project',
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    resetProjectState,
    leaveProject,
    loadTimeline,
    openProject,
  };
}
