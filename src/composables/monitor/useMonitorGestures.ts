import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;
const ZOOM_STEP_FACTOR = 0.001;

export function useMonitorGestures(input: {
  projectStore: ReturnType<typeof useProjectStore>;
  viewportEl: Ref<HTMLElement | null>;
}) {
  const workspaceStore = useWorkspaceStore();

  const isPreviewSelected = ref(false);

  const isPanning = ref(false);
  const panStart = ref({ x: 0, y: 0 });
  const panOrigin = ref({ x: 0, y: 0 });

  const panX = computed({
    get: () => input.projectStore.projectSettings.monitor?.panX ?? 0,
    set: (v: number) => {
      if (!input.projectStore.projectSettings.monitor) return;
      input.projectStore.projectSettings.monitor.panX = v;
    },
  });

  const panY = computed({
    get: () => input.projectStore.projectSettings.monitor?.panY ?? 0,
    set: (v: number) => {
      if (!input.projectStore.projectSettings.monitor) return;
      input.projectStore.projectSettings.monitor.panY = v;
    },
  });

  const zoom = computed({
    get: () => input.projectStore.projectSettings.monitor?.zoom ?? 1,
    set: (v: number) => {
      if (!input.projectStore.projectSettings.monitor) return;
      input.projectStore.projectSettings.monitor.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));
    },
  });

  const zoomPercent = computed(() => Math.round(zoom.value * 100));

  const workspaceStyle = computed(() => ({
    transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
    transformOrigin: '50% 50%',
  }));

  function resetView() {
    if (!input.projectStore.projectSettings.monitor) return;
    input.projectStore.projectSettings.monitor.panX = 0;
    input.projectStore.projectSettings.monitor.panY = 0;
    input.projectStore.projectSettings.monitor.zoom = 1;
  }

  function centerMonitor() {
    if (!input.projectStore.projectSettings.monitor) return;
    input.projectStore.projectSettings.monitor.panX = 0;
    input.projectStore.projectSettings.monitor.panY = 0;
  }

  function resetZoom() {
    if (!input.projectStore.projectSettings.monitor) return;
    input.projectStore.projectSettings.monitor.zoom = 1;
  }

  function onPreviewPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    isPreviewSelected.value = true;
    event.stopPropagation();
  }

  function onViewportPointerDown(event: PointerEvent) {
    const settings = workspaceStore.userSettings?.mouse?.monitor ?? {
      wheel: 'zoom',
      wheelShift: 'scroll_horizontal',
      middleClick: 'pan',
    };

    if (event.button === 1) {
      if (settings?.middleClick === 'pan') {
        isPanning.value = true;
        panStart.value = { x: event.clientX, y: event.clientY };
        panOrigin.value = { x: panX.value, y: panY.value };
        (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
      return;
    }
  }

  function onViewportPointerMove(event: PointerEvent) {
    if (!isPanning.value) return;
    const dx = event.clientX - panStart.value.x;
    const dy = event.clientY - panStart.value.y;
    panX.value = panOrigin.value.x + dx;
    panY.value = panOrigin.value.y + dy;
  }

  function stopPan(event?: PointerEvent) {
    if (!isPanning.value) return;
    isPanning.value = false;
    if (event) {
      try {
        (event.currentTarget as HTMLElement | null)?.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }
  }

  function onWindowPointerUp() {
    isPanning.value = false;
  }

  function applyZoomAtPoint(params: { delta: number; clientX: number; clientY: number }) {
    const el = input.viewportEl.value;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const prevZoom = zoom.value;
    const rawNext = prevZoom * (1 - params.delta * ZOOM_STEP_FACTOR);
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, rawNext));

    // Viewport center in local coords
    const vpCx = rect.width / 2;
    const vpCy = rect.height / 2;

    // Cursor position relative to viewport center
    const cx = params.clientX - rect.left - vpCx;
    const cy = params.clientY - rect.top - vpCy;

    // Adjust pan so that the point under cursor stays fixed
    const scale = nextZoom / prevZoom;
    panX.value = cx + (panX.value - cx) * scale;
    panY.value = cy + (panY.value - cy) * scale;
    zoom.value = nextZoom;
  }

  function onViewportWheel(e: WheelEvent) {
    if (e.defaultPrevented) return;

    const isShift = e.shiftKey;
    const settings = workspaceStore.userSettings?.mouse?.monitor ?? {
      wheel: 'zoom',
      wheelShift: 'scroll_horizontal',
      middleClick: 'pan',
    };

    const action = isShift ? settings.wheelShift : settings.wheel;

    if (action === 'none') {
      e.preventDefault();
      return;
    }

    const isHorizontalScroll = e.deltaX !== 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const delta = isHorizontalScroll ? e.deltaX : e.deltaY;
    if (!Number.isFinite(delta) || delta === 0) return;

    if (action === 'zoom') {
      e.preventDefault();
      applyZoomAtPoint({ delta, clientX: e.clientX, clientY: e.clientY });
      return;
    }

    if (action === 'scroll_vertical') {
      e.preventDefault();
      panY.value -= delta;
      return;
    }

    if (action === 'scroll_horizontal') {
      e.preventDefault();
      panX.value -= delta;
      return;
    }
  }

  onMounted(() => {
    window.addEventListener('pointerup', onWindowPointerUp);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('pointerup', onWindowPointerUp);
  });

  return {
    isPreviewSelected,
    zoom,
    zoomPercent,
    workspaceStyle,
    resetView,
    centerMonitor,
    resetZoom,
    onPreviewPointerDown,
    onViewportPointerDown,
    onViewportPointerMove,
    stopPan,
    onViewportWheel,
  };
}
