import { ref, onScopeDispose } from 'vue';
import { useFullscreen } from '@vueuse/core';
import { isTauriRuntime } from '~/utils/runtime';
import type { Ref } from 'vue';

export function useAppFullscreen(target?: Ref<HTMLElement | null>) {
  if (!isTauriRuntime()) {
    return useFullscreen(target);
  }

  const isFullscreen = ref(false);
  let unlisten: (() => void) | null = null;
  let syncTimeout: ReturnType<typeof setTimeout> | null = null;

  async function getWindow() {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow();
  }

  async function syncState() {
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(async () => {
      try {
        const win = await getWindow();
        isFullscreen.value = await win.isFullscreen();
      } catch {
        // ignore in test environments or if window API is unavailable
      }
    }, 200);
  }

  async function enter() {
    try {
      const win = await getWindow();
      await win.setFullscreen(true);
      isFullscreen.value = true;
    } catch {
      // ignore
    }
  }

  async function exit() {
    try {
      const win = await getWindow();
      await win.setFullscreen(false);
      isFullscreen.value = false;
    } catch {
      // ignore
    }
  }

  async function toggle() {
    if (isFullscreen.value) {
      await exit();
    } else {
      await enter();
    }
  }

  // Initialize state and listen for changes
  void (async () => {
    try {
      const win = await getWindow();
      isFullscreen.value = await win.isFullscreen();
      unlisten = await win.onResized(() => {
        void syncState();
      });
    } catch {
      // ignore
    }
  })();

  onScopeDispose(() => {
    unlisten?.();
    if (syncTimeout) clearTimeout(syncTimeout);
  });

  return {
    isSupported: ref(true),
    isFullscreen,
    enter,
    exit,
    toggle,
  };
}
