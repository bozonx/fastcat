import { ref, computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';

export function useMonitorDisplay() {
  const projectStore = useProjectStore();

  const containerEl = ref<HTMLDivElement | null>(null);
  const viewportEl = ref<HTMLDivElement | null>(null);
  const canvasDisplaySize = ref({ width: 0, height: 0 });

  const MIN_CANVAS_DIMENSION = 16;
  const MAX_CANVAS_DIMENSION = 7680;

  const exportWidth = computed(() => {
    const value = Number(projectStore.projectSettings.export.width);
    if (!Number.isFinite(value) || value <= 0) return 1920;
    return Math.round(Math.min(MAX_CANVAS_DIMENSION, Math.max(MIN_CANVAS_DIMENSION, value)));
  });

  const exportHeight = computed(() => {
    const value = Number(projectStore.projectSettings.export.height);
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
    const value = Number(projectStore.projectSettings.monitor?.previewResolution);
    return Number.isFinite(value) && value > 0 ? value : 480;
  });

  const renderWidth = computed(() => {
    return Math.round(renderHeight.value * aspectRatio.value);
  });

  const canvasScale = computed(() => {
    const dw = canvasDisplaySize.value.width;
    const dh = canvasDisplaySize.value.height;
    if (!dw || !dh || !renderWidth.value || !renderHeight.value) return 1;
    return Math.min(dw / renderWidth.value, dh / renderHeight.value);
  });

  function getCanvasWrapperStyle() {
    return {
      width: `${canvasDisplaySize.value.width}px`,
      height: `${canvasDisplaySize.value.height}px`,
      overflow: 'hidden',
    };
  }

  function getCanvasInnerStyle() {
    return {
      width: `${renderWidth.value}px`,
      height: `${renderHeight.value}px`,
      transform: `scale(${canvasScale.value})`,
      transformOrigin: 'top left',
    };
  }

  function updateCanvasDisplaySize() {
    const viewport = viewportEl.value;
    if (!viewport) return;

    const availableWidth = viewport.clientWidth;
    const availableHeight = viewport.clientHeight;

    if (availableWidth <= 0 || availableHeight <= 0) {
      canvasDisplaySize.value = { width: 0, height: 0 };
      return;
    }

    let width = availableWidth;
    let height = Math.round(width / aspectRatio.value);

    if (height > availableHeight) {
      height = availableHeight;
      width = Math.round(height * aspectRatio.value);
    }

    canvasDisplaySize.value = { width, height };
  }

  return {
    containerEl,
    viewportEl,
    canvasDisplaySize,
    exportWidth,
    exportHeight,
    renderWidth,
    renderHeight,
    aspectRatio,
    canvasScale,
    getCanvasWrapperStyle,
    getCanvasInnerStyle,
    updateCanvasDisplaySize,
  };
}
