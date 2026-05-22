import { onMounted, onUnmounted } from 'vue';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';

export function useConfirmClose() {
  const backgroundTasksStore = useBackgroundTasksStore();
  const { t } = useI18n();

  let unlistenTauriClose: (() => void) | undefined;

  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (backgroundTasksStore.hasActiveTasks) {
      e.preventDefault();
      // Modern browsers ignore the return value text and show a generic message
      e.returnValue = '';
    }
  }

  async function setupTauriCloseHandler() {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return;
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { confirm } = await import('@tauri-apps/plugin-dialog');
      const appWindow = getCurrentWindow();

      unlistenTauriClose = await appWindow.onCloseRequested(async (event) => {
        if (backgroundTasksStore.hasActiveTasks) {
          const confirmed = await confirm(
            t('videoEditor.backgroundTasks.confirmCloseMessage'),
            {
              title: t('videoEditor.backgroundTasks.confirmCloseTitle'),
              kind: 'warning',
            },
          );

          if (!confirmed) {
            event.preventDefault();
          }
        }
      });
    } catch (err) {
      console.error('Failed to setup Tauri close handler:', err);
    }
  }

  onMounted(() => {
    window.addEventListener('beforeunload', onBeforeUnload);
    setupTauriCloseHandler();
  });

  onUnmounted(() => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    if (unlistenTauriClose) {
      unlistenTauriClose();
    }
  });
}
