import { ref, computed, onMounted } from 'vue';
import {
  evaluateBrowserCompatibility,
  detectBrowserGpuFlagInfo,
  type BrowserGpuFlagInfo,
  getGpuMockFromQuery,
} from '~/utils/browser-compatibility';
import { isTauriRuntime } from '~/utils/runtime';

const DISMISS_KEY = 'fastcat_webgpu_modal_dismissed';

export function useGpuCapability() {
  const isWebGpuSupported = ref<boolean>(true);
  const isModalDismissed = ref<boolean>(false);
  const browserInfo = ref<BrowserGpuFlagInfo>(detectBrowserGpuFlagInfo());

  const checkCapabilities = () => {
    if (typeof window === 'undefined') return;

    // Is Tauri desktop app? If so, native engine / wgpu handles GPU directly
    if (isTauriRuntime()) {
      isWebGpuSupported.value = true;
      return;
    }

    const report = evaluateBrowserCompatibility();
    const gpuCheck = report.checks.find((c) => c.id === 'webgpu');
    isWebGpuSupported.value = gpuCheck ? gpuCheck.supported : true;

    browserInfo.value = detectBrowserGpuFlagInfo();

    // Read dismissal state from sessionStorage
    try {
      isModalDismissed.value = sessionStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      isModalDismissed.value = false;
    }

    // Force query param check for dev testing
    const queryMock = getGpuMockFromQuery();
    if (queryMock !== null) {
      isWebGpuSupported.value = queryMock;
    }
  };

  const dismissModal = () => {
    isModalDismissed.value = true;
    try {
      sessionStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // Ignore quota or security errors in iframe/restricted storage
    }
  };

  const resetDismissal = () => {
    isModalDismissed.value = false;
    try {
      sessionStorage.removeItem(DISMISS_KEY);
    } catch {
      // Ignore
    }
  };

  const shouldShowModal = computed(() => {
    if (isTauriRuntime()) return false;
    return !isWebGpuSupported.value && !isModalDismissed.value;
  });

  onMounted(() => {
    checkCapabilities();
  });

  return {
    isWebGpuSupported,
    isModalDismissed,
    browserInfo,
    shouldShowModal,
    dismissModal,
    resetDismissal,
    checkCapabilities,
  };
}
