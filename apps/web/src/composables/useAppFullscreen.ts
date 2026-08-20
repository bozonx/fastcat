import { ref } from 'vue';
import { useFullscreen } from '@vueuse/core';
import { isTauriRuntime } from '~/utils/runtime';
import type { Ref } from 'vue';

export function useAppFullscreen(target?: Ref<HTMLElement | null>) {
  if (!isTauriRuntime()) {
    return useFullscreen(target);
  }

  const isFullscreen = ref(false);

  async function enter() {
    isFullscreen.value = true;
  }

  async function exit() {
    isFullscreen.value = false;
  }

  async function toggle() {
    if (isFullscreen.value) {
      await exit();
    } else {
      await enter();
    }
  }

  return {
    isSupported: ref(true),
    isFullscreen,
    enter,
    exit,
    toggle,
  };
}
