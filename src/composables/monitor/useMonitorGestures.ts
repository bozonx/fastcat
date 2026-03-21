import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { useProjectStore } from '~/stores/project.store';
import { isSecondaryWheel, getWheelDelta, DRAG_DEADZONE_PX } from '~/utils/mouse';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useUiStore } from '~/stores/ui.store';
import {
  DEFAULT_MONITOR_ZOOM,
  formatZoomMultiplier,
  MAX_MONITOR_ZOOM,
  MIN_MONITOR_ZOOM,
  snapMonitorZoom,
  stepMonitorZoom,
} from '~/utils/zoom';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';

export function useMonitorGestures(input: {
  projectStore: ReturnType<typeof useProjectStore>;
  viewportEl: Ref<HTMLElement | null>;
}) {
  const workspaceStore = useWorkspaceStore();
  const uiStore = useUiStore();

  const isPreviewSelected = ref(false);

  const isPanning = ref(false);
  const panStart = ref({ x: 0, y: 0 });
  const panOrigin = ref({ x: 0, y: 0 });
  const middlePointerDown = ref<{ x: number; y: number; moved: boolean } | null>(null);

  const panX = computed({
    get: () => input.projectStore.activeMonitor?.panX ?? 0,
    set: (v: number) => {
      if (!input.projectStore.activeMonitor) return;
      input.projectStore.activeMonitor.panX = v;
    },
  });

  const panY = computed({
    get: () => input.projectStore.activeMonitor?.panY ?? 0,
    set: (v: number) => {
      if (!input.projectStore.activeMonitor) return;
      input.projectStore.activeMonitor.panY = v;
    },
  });

  const zoom = computed({
    get: () => input.projectStore.activeMonitor?.zoom ?? 1,
    set: (v: number) => {
      if (!input.projectStore.activeMonitor) return;
      input.projectStore.activeMonitor.zoom = snapMonitorZoom(v);
    },
  });

  const zoomExact = computed({
    get: () => input.projectStore.activeMonitor?.zoom ?? DEFAULT_MONITOR_ZOOM,
    set: (v: number) => {
      if (!input.projectStore.activeMonitor) return;
      input.projectStore.activeMonitor.zoom = Math.min(
        MAX_MONITOR_ZOOM,
        Math.max(MIN_MONITOR_ZOOM, v),
      );
    },
  });

  const zoomLabel = computed(() => formatZoomMultiplier(zoom.value));

  const workspaceStyle = computed(() => ({
    transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
    transformOrigin: '50% 50%',
  }));

  function resetView() {
    if (!input.projectStore.activeMonitor) return;
    input.projectStore.activeMonitor.panX = 0;
    input.projectStore.activeMonitor.panY = 0;
    input.projectStore.activeMonitor.zoom = DEFAULT_MONITOR_ZOOM;
  }

  function centerMonitor() {
    if (!input.projectStore.activeMonitor) return;
    input.projectStore.activeMonitor.panX = 0;
    input.projectStore.activeMonitor.panY = 0;
  }

  function resetZoom() {
    if (!input.projectStore.activeMonitor) return;
    input.projectStore.activeMonitor.zoom = DEFAULT_MONITOR_ZOOM;
  }

  function onCustomZoom(dir: number) {
    zoom.value = stepMonitorZoom(zoom.value, dir > 0 ? 1 : -1);
  }

  function onCustomZoomReset(e: Event) {
    const detail = (e as CustomEvent).detail;
    if (detail?.target !== 'monitor') return;

    resetZoom();
  }

  function onPreviewPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    isPreviewSelected.value = true;
    event.stopPropagation();
  }

  function onViewportPointerDown(event: PointerEvent) {
    const settings = workspaceStore.userSettings.mouse.monitor;

    if (event.button === 1) {
      middlePointerDown.value = { x: event.clientX, y: event.clientY, moved: false };

      if (settings.middleDrag === 'pan') {
        isPanning.value = true;
        panStart.value = { x: event.clientX, y: event.clientY };
        panOrigin.value = { x: panX.value, y: panY.value };
        (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
      return;
    }
  }

  function fitMonitor() {
    const el = input.viewportEl.value;
    if (!input.projectStore.activeMonitor || !el) return;
    const vpW = el.clientWidth;
    const vpH = el.clientHeight;
    const w = input.projectStore.activeMonitor.width ?? vpW;
    const h = input.projectStore.activeMonitor.height ?? vpH;
    if (!w || !h) {
      resetView();
      return;
    }
    const fitZoom = Math.min(vpW / w, vpH / h);
    input.projectStore.activeMonitor.zoom = Math.min(
      MAX_MONITOR_ZOOM,
      Math.max(MIN_MONITOR_ZOOM, fitZoom),
    );
    input.projectStore.activeMonitor.panX = 0;
    input.projectStore.activeMonitor.panY = 0;
  }

  function onViewportAuxClick(event: MouseEvent) {
    if (event.button !== 1) return;

    if (middlePointerDown.value?.moved) {
      middlePointerDown.value = null;
      return;
    }

    middlePointerDown.value = null;

    const settings = workspaceStore.userSettings.mouse.monitor;
    const action = settings.middleClick;

    if (action === 'fit') {
      fitMonitor();
    } else if (action === 'center') {
      centerMonitor();
    } else if (action === 'reset_zoom') {
      resetZoom();
    } else if (action === 'reset_zoom_center') {
      resetView();
    }
  }

  function onViewportPointerMove(event: PointerEvent) {
    if (middlePointerDown.value) {
      const dx = event.clientX - middlePointerDown.value.x;
      const dy = event.clientY - middlePointerDown.value.y;
      if (Math.abs(dx) > DRAG_DEADZONE_PX || Math.abs(dy) > DRAG_DEADZONE_PX) {
        middlePointerDown.value.moved = true;
      }
    }

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

  function applyZoomAtPoint(params: { delta: number; clientX: number; clientY: number }) {
    const el = input.viewportEl.value;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const prevZoom = zoom.value;
    const direction = params.delta < 0 ? 1 : -1;
    const nextZoom = stepMonitorZoom(prevZoom, direction);
    if (nextZoom === prevZoom) return;

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

    // Native trackpad pinch-to-zoom always sets ctrlKey to true
    if (e.ctrlKey) {
      e.preventDefault();
      // Trackpad pinch delta usually maps to deltaY. Adjust scale factor based on standard browser behavior
      const pinchDelta = -e.deltaY;
      applyZoomAtPoint({ delta: pinchDelta, clientX: e.clientX, clientY: e.clientY });
      return;
    }

    const isShift = isLayer1Active(e, workspaceStore.userSettings);
    const isSecondary = isSecondaryWheel(e);
    const settings = workspaceStore.userSettings.mouse.monitor;
    const secondaryAction = isShift ? settings.wheelSecondaryShift : settings.wheelSecondary;

    const action = isSecondary ? secondaryAction : isShift ? settings.wheelShift : settings.wheel;

    if (action === 'none') {
      e.preventDefault();
      return;
    }

    const delta = getWheelDelta(e);
    if (!Number.isFinite(delta) || delta === 0) return;

    if (action === 'zoom') {
      e.preventDefault();
      applyZoomAtPoint({ delta, clientX: e.clientX, clientY: e.clientY });
      return;
    }

    if (action === 'scroll_vertical') {
      // Let native vertical scroll happen without modifiers unless shifted
      if (!isShift && !isSecondaryWheel(e)) return;

      e.preventDefault();
      panY.value -= delta;
      return;
    }

    if (action === 'scroll_horizontal') {
      // Let native horizontal scroll happen if trackpad
      if (isSecondaryWheel(e) && !isShift) return;

      e.preventDefault();
      panX.value -= delta;
      return;
    }
  }

  watch(
    () => uiStore.monitorZoomTrigger,
    (trigger) => {
      if (!trigger.timestamp) return;
      onCustomZoom(trigger.dir);
    },
    { deep: true },
  );

  watch(
    () => uiStore.monitorZoomResetTrigger,
    (timestamp) => {
      if (!timestamp) return;
      resetZoom();
    },
  );

  onMounted(() => {
    input.viewportEl.value?.addEventListener('wheel', onViewportWheel, { passive: false });
  });

  onBeforeUnmount(() => {
    input.viewportEl.value?.removeEventListener('wheel', onViewportWheel);
    isPanning.value = false;
  });

  return {
    isPreviewSelected,
    zoom,
    zoomExact,
    zoomLabel,
    workspaceStyle,
    resetView,
    centerMonitor,
    resetZoom,
    onPreviewPointerDown,
    onViewportPointerDown,
    onViewportPointerMove,
    onViewportAuxClick,
    stopPan,
    onViewportWheel,
  };
}
