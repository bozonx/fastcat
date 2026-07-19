import { ref, computed, type Ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { resolveMonitorPreviewSize } from '~/utils/monitor-preview-resolution';

export function useMonitorDisplay(options?: { isMobile?: Ref<boolean>; viewportEl?: Ref<HTMLElement | null> }) {
  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();

  const containerEl = ref<HTMLDivElement | null>(null);
  const viewportEl = ref<HTMLDivElement | null>(null);
  const viewportSize = ref({ width: 0, height: 0 });

  const MIN_CANVAS_DIMENSION = 16;
  const MAX_CANVAS_DIMENSION = 7680;

  const exportWidth = computed(() => {
    const value = Number(
      timelineStore.timelineFormat?.width ?? projectStore.projectSettings.project.width,
    );
    if (!Number.isFinite(value) || value <= 0) return 1920;
    return Math.round(Math.min(MAX_CANVAS_DIMENSION, Math.max(MIN_CANVAS_DIMENSION, value)));
  });

  const exportHeight = computed(() => {
    const value = Number(
      timelineStore.timelineFormat?.height ?? projectStore.projectSettings.project.height,
    );
    if (!Number.isFinite(value) || value <= 0) return 1080;
    return Math.round(Math.min(MAX_CANVAS_DIMENSION, Math.max(MIN_CANVAS_DIMENSION, value)));
  });

  const aspectRatio = computed(() => {
    const width = exportWidth.value;
    const height = exportHeight.value;
    if (width <= 0 || height <= 0) return 16 / 9;
    return width / height;
  });

  const previewSize = computed(() =>
    resolveMonitorPreviewSize({
      sceneWidth: exportWidth.value,
      sceneHeight: exportHeight.value,
      viewportWidth: viewportSize.value.width || exportWidth.value,
      viewportHeight: viewportSize.value.height || exportHeight.value,
      devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      manualScale: projectStore.activeMonitor?.previewResolution,
    }),
  );
  const renderWidth = computed(() => previewSize.value.width);
  const renderHeight = computed(() => previewSize.value.height);

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
    const viewport = options?.viewportEl?.value ?? viewportEl.value;
    if (!viewport) return;
    const width = viewport.clientWidth || viewport.getBoundingClientRect().width;
    const height = viewport.clientHeight || viewport.getBoundingClientRect().height;
    viewportSize.value = { width: Math.max(0, width), height: Math.max(0, height) };
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
