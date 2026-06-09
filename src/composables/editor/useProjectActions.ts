import { createDevLogger } from '~/utils/dev-logger';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
const log = createDevLogger('useProjectActions');

export function useProjectActions() {
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();
  const mediaStore = useMediaStore();
  const uiStore = useUiStore();
  const focusStore = useFocusStore();
  const toast = useToast();
  const router = useRouter();

  async function resetProjectState() {
    // Flush the active timeline's pending (scheduled) autosave before tearing
    // down: `resetTimelineState` clears the timer without writing, so otherwise
    // un-flushed drag edits would be lost on project leave/switch.
    try {
      await timelineStore.flushTimelineAutosave();
    } catch (e) {
      log.warn('Failed to flush autosave during reset:', e);
    }
    try {
      await projectStore.saveProjectSettings();
    } catch (e) {
      log.warn('Failed to save project settings during reset:', e);
    }
    timelineStore.resetTimelineState();
    mediaStore.resetMediaState();
    await projectStore.closeProject();
  }

  async function leaveProject(redirectPath: string = '/') {
    try {
      // Сначала сбрасываем состояние
      await resetProjectState();
      // Затем переходим на указанный путь
      await router.push(redirectPath);
    } catch (e) {
      log.warn('Failed to leave project:', e);
    }
  }

  async function loadTimeline(path: string) {
    if (!projectStore.currentProjectName) return;

    try {
      // Persist the outgoing timeline's crash-recovery sidecar before the active
      // path changes — only one doc lives in memory, so its accumulated edits
      // would otherwise be lost when the new timeline replaces it.
      await timelineStore.flushTimelineAutosave();

      // Save project settings before changing the active path to capture
      // the playhead/zoom of the outgoing timeline.
      await projectStore.saveProjectSettings();

      await projectStore.openTimelineFile(path);
      focusStore.setActiveTimelinePath(path);
      await timelineStore.loadTimeline();
      void timelineStore.loadTimelineMetadata();
    } catch (e) {
      toast.add({
        color: 'error',
        title: 'Failed to load timeline',
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function openProject(name: string) {
    try {
      await resetProjectState();
      await projectStore.openProject(name);
      if (!projectStore.currentProjectName) {
        return;
      }
      if (name) {
        uiStore.restoreFileTreeStateOnce();
      }
      if (projectStore.currentTimelinePath) {
        await loadTimeline(projectStore.currentTimelinePath);
      }
      // Surface crashed *background* tabs (newer sidecar than saved file) so they
      // show as dirty and are covered by close-protection, not just the active one.
      void timelineStore.scanOpenPathsForRecovery();
    } catch (e) {
      toast.add({
        color: 'error',
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
