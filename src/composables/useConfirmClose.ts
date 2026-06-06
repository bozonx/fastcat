import { createDevLogger } from '~/utils/dev-logger';
import { onMounted, onUnmounted } from 'vue';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { isTauriRuntime } from '~/utils/runtime';
const log = createDevLogger('useConfirmClose');

export function useConfirmClose() {
  const backgroundTasksStore = useBackgroundTasksStore();
  const timelineStore = useTimelineStore();
  const uiStore = useUiStore();
  const { loadTimeline } = useProjectActions();
  const toast = useToast();
  const { t } = useI18n();

  let unlistenTauriClose: (() => void) | undefined;

  function dirtyTimelinePaths(): string[] {
    return Object.entries(timelineStore.dirtyPaths)
      .filter(([, dirty]) => dirty)
      .map(([path]) => path);
  }

  // Promise-based 3-way prompt (Save / Don't Save / Cancel), resolved by
  // CloseConfirmDialog. A stale pending dialog is settled as 'cancel' first.
  function requestCloseDecision(dirtyCount: number): Promise<'save' | 'dont-save' | 'cancel'> {
    return new Promise((resolve) => {
      uiStore.pendingCloseDialog?.resolve('cancel');
      uiStore.pendingCloseDialog = { dirtyCount, resolve };
    });
  }

  // Saves every dirty timeline to its main file. Background tabs are made active
  // (load + save) the same way the in-app tab-close flow does; a clean save drops
  // that tab's recovery sidecar. Recovery prompts are suppressed during the loop.
  async function saveAllDirtyTimelines() {
    const dirty = dirtyTimelinePaths();
    timelineStore.skipRecoveryDialog = true;
    try {
      for (const path of dirty) {
        if (timelineStore.currentTimelinePath === path) {
          await timelineStore.saveTimeline();
        } else {
          await loadTimeline(path);
          await timelineStore.saveTimeline();
        }
      }
    } finally {
      timelineStore.skipRecoveryDialog = false;
    }
  }

  async function confirmActiveTasks(confirm: typeof import('@tauri-apps/plugin-dialog').confirm) {
    if (!backgroundTasksStore.hasActiveTasks) return true;
    return await confirm(t('videoEditor.backgroundTasks.confirmCloseMessage'), {
      title: t('videoEditor.backgroundTasks.confirmCloseTitle'),
      kind: 'warning',
    });
  }

  async function cleanupOpenAutosaves() {
    try {
      await timelineStore.deleteAllOpenAutosaves();
    } catch (e) {
      log.warn('Failed to clean autosaves on close', e);
    }
  }

  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (backgroundTasksStore.hasActiveTasks || timelineStore.hasAnyDirtyTimeline) {
      // Web can't show a custom dialog here; flush the sidecars so unsaved work
      // survives as recoverable state (never deleted on this path), and let the
      // browser show its generic confirm.
      void timelineStore.flushTimelineAutosave();
      e.preventDefault();
      // Modern browsers ignore the return value text and show a generic message
      e.returnValue = '';
    }
  }

  async function setupTauriCloseHandler() {
    if (!isTauriRuntime()) {
      return;
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { confirm } = await import('@tauri-apps/plugin-dialog');
      const appWindow = getCurrentWindow();

      let isClosing = false;

      unlistenTauriClose = await appWindow.onCloseRequested(async (event) => {
        if (isClosing) return;
        // Always intercept so async cleanup (and the prompt) runs before the
        // window actually closes.
        event.preventDefault();

        const dirty = dirtyTimelinePaths();
        const hasUnsaved = dirty.length > 0;

        if (hasUnsaved) {
          // Real Save / Don't Save / Cancel: no path silently discards work.
          const choice = await requestCloseDecision(dirty.length);
          if (choice === 'cancel') return;
          if (choice === 'save') {
            try {
              await saveAllDirtyTimelines();
            } catch (e) {
              // A failed save must not close the window; the user would lose work.
              log.error('Failed to save timelines on close', e);
              toast.add({ title: t('common.saveError'), color: 'error' });
              return;
            }
          }
          if (!(await confirmActiveTasks(confirm))) return;
          // Clean save or explicit 'dont-save': this is now a confirmed clean
          // shutdown, so remove sidecars before destroying the window.
          await cleanupOpenAutosaves();
        } else if (backgroundTasksStore.hasActiveTasks) {
          if (!(await confirmActiveTasks(confirm))) return;
          await cleanupOpenAutosaves();
        } else {
          // Clean exit: drop the sidecars so their presence on next launch
          // unambiguously means a crash.
          await cleanupOpenAutosaves();
        }

        isClosing = true;
        // destroy() terminates the Tauri process; unlisten and other cleanup
        // are implicitly handled by the runtime.
        await appWindow.destroy();
      });
    } catch (err) {
      log.error('Failed to setup Tauri close handler:', err);
    }
  }

  onMounted(() => {
    window.addEventListener('beforeunload', onBeforeUnload);
    void setupTauriCloseHandler().catch((err) => {
      log.error('Failed to setup Tauri close handler:', err);
    });
  });

  onUnmounted(() => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    if (unlistenTauriClose) {
      unlistenTauriClose();
    }
  });
}
