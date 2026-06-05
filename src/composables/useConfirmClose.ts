import { createDevLogger } from '~/utils/dev-logger';
import { onMounted, onUnmounted } from 'vue';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { isTauriRuntime } from '~/utils/runtime';
const log = createDevLogger('useConfirmClose');

export function useConfirmClose() {
  const backgroundTasksStore = useBackgroundTasksStore();
  const timelineStore = useTimelineStore();
  const { t } = useI18n();

  let unlistenTauriClose: (() => void) | undefined;

  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (backgroundTasksStore.hasActiveTasks || timelineStore.hasAnyDirtyTimeline) {
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
        // Always intercept so async cleanup (and the confirm) runs before the
        // window actually closes.
        event.preventDefault();

        const hasUnsaved = timelineStore.hasAnyDirtyTimeline;
        if (backgroundTasksStore.hasActiveTasks || hasUnsaved) {
          const confirmed = await confirm(
            hasUnsaved
              ? t('videoEditor.timeline.confirmCloseUnsavedMessage')
              : t('videoEditor.backgroundTasks.confirmCloseMessage'),
            {
              title: hasUnsaved
                ? t('videoEditor.timeline.confirmCloseUnsavedTitle')
                : t('videoEditor.backgroundTasks.confirmCloseTitle'),
              kind: 'warning',
            },
          );

          // User cancelled (or, for unsaved work, chose not to discard): stay open.
          if (!confirmed) return;
        }

        // Clean exit (nothing unsaved, or the user chose "Don't save"): drop the
        // crash-recovery sidecars so their presence on next launch unambiguously
        // means a crash.
        try {
          await timelineStore.deleteAllOpenAutosaves();
        } catch (e) {
          log.warn('Failed to clean autosaves on close', e);
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
