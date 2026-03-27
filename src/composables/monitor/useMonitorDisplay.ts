import { ref, computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';

export function useMonitorDisplay() {
  const projectStore = useProjectStore();

  const containerEl = ref<HTMLDivElement | null>(null);
  const viewportEl = ref<HTMLDivElement | null>(null);

  const MIN_CANVAS_DIMENSION = 16;
  const MAX_CANVAS_DIMENSION = 7680;

  const exportWidth = computed(() => {
    const value = Number(projectStore.projectSettings.project.width);
    if (!Number.isFinite(value) || value <= 0) return 1920;
    return Math.round(Math.min(MAX_CANVAS_DIMENSION, Math.max(MIN_CANVAS_DIMENSION, value)));
  });

  const exportHeight = computed(() => {
    const value = Number(projectStore.projectSettings.project.height);
    if (!Number.isFinite(value) || value <= 0) return 1080;
    return Math.round(Math.min(MAX_CANVAS_DIMENSION, Math.max(MIN_CANVAS_DIMENSION, value)));
  });

  const aspectRatio = computed(() => {
    const width = exportWidth.value;
    const height = exportHeight.value;
    if (width <= 0 || height <= 0) return 16 / 9;
    return width / height;
  });

  const renderHeight = computed(() => {
    const value = Number(projectStore.activeMonitor?.previewResolution);
    if (!Number.isFinite(value) || value <= 0) {
      return Math.round((exportHeight.value * 0.5) / 2) * 2;
    }

    // Interpret values <= 1 as scale factor relative to project height
    if (value <= 1) {
      return Math.round((exportHeight.value * value) / 2) * 2; // Keep even dimensions
    }

    return Math.round(value / 2) * 2; // Always keep even dimensions
  });

  const renderWidth = computed(() => {
    return Math.round(renderHeight.value * aspectRatio.value);
  });

  function getCanvasWrapperStyle() {
    return {
      width: `${renderWidth.value}px`,
      height: `${renderHeight.value}px`,
      overflow: 'hidden',
    };
  }

  function getCanvasInnerStyle() {
    return {
      width: `${renderWidth.value}px`,
      height: `${renderHeight.value}px`,
    };
  }

  function updateCanvasDisplaySize() {
    // Canvas display size is fixed to the selected preview resolution.
    // Viewport clipping is handled by CSS overflow on the viewport container.
  }

  return {
    containerEl,
    viewportEl,
    exportWidth,
    exportHeight,
    renderWidth,
    renderHeight,
    aspectRatio,
    getCanvasWrapperStyle,
    getCanvasInnerStyle,
    updateCanvasDisplaySize,
  };
}
