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
  renderWidth: Ref<number>;
  renderHeight: Ref<number>;
}) {
  const workspaceStore = useWorkspaceStore();
  const uiStore = useUiStore();

  const isPreviewSelected = ref(false);

  const isPanning = ref(false);
  const panStart = ref({ x: 0, y: 0 });
  const panOrigin = ref({ x: 0, y: 0 });
  const middlePointerDown = ref<{ x: number; y: number; moved: boolean } | null>(null);

  const activePointers = new Map<number, { x: number; y: number }>();
  let initialPinchDistance = 0;
  let initialPinchZoom = 1;
  let initialPinchCenter = { x: 0, y: 0 };
  let initialPinchPan = { x: 0, y: 0 };

  const isVolumeAdjusting = ref(false);
  const volumeTrackerId = ref<number | null>(null);
  const volumeStartY = ref(0);
  const initialVolume = ref(1);

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
    input.projectStore.activeMonitor.zoom = 1;
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
    
    // Allow touch gestures for volume/zoom to pass through to viewport
    if (event.pointerType !== 'touch') {
      event.stopPropagation();
    }
  }

  function onViewportPointerDown(event: PointerEvent) {
    const settings = workspaceStore.userSettings.mouse.monitor;

    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (event.pointerType === 'touch' || event.button === 0) {
      const rect = input.viewportEl.value?.getBoundingClientRect();
      // Allow gestures on the right half (60% and more) for volume
      const isRightZone = rect && event.clientX > rect.left + rect.width * 0.6;

      if (isRightZone && activePointers.size === 1) {
        isVolumeAdjusting.value = true;
        volumeTrackerId.value = event.pointerId;
        volumeStartY.value = event.clientY;
        initialVolume.value = uiStore.monitorVolume;
      } else if (activePointers.size === 1) {
        isPanning.value = true;
        panStart.value = { x: event.clientX, y: event.clientY };
        panOrigin.value = { x: panX.value, y: panY.value };
      } else if (activePointers.size === 2) {
        // Start pinch
        const ids = Array.from(activePointers.keys());
        const p1 = activePointers.get(ids[0]!);
        const p2 = activePointers.get(ids[1]!);
        if (p1 && p2) {
          initialPinchDistance = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          initialPinchZoom = zoom.value;
          initialPinchCenter = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          initialPinchPan = { x: panX.value, y: panY.value };
        }
      }
      (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
    }

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
    const w = input.renderWidth.value;
    const h = input.renderHeight.value;
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

  function onViewportDoubleClick(event: MouseEvent) {
    const settings = workspaceStore.userSettings.mouse.monitor;
    const action = settings.doubleClick;

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

  function onViewportContextMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  function onViewportPointerMove(event: PointerEvent) {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (middlePointerDown.value) {
      const dx = event.clientX - middlePointerDown.value.x;
      const dy = event.clientY - middlePointerDown.value.y;
      if (Math.abs(dx) > DRAG_DEADZONE_PX || Math.abs(dy) > DRAG_DEADZONE_PX) {
        middlePointerDown.value.moved = true;
      }
    }

    if (activePointers.size >= 2) {
      if (!isVolumeAdjusting.value) {
        // Only cancel pan if we are panning. Keep volume adjusting intact if a second finger touches briefly.
        isPanning.value = false;
      }
    }

    if (activePointers.size === 2) {
      // Handle pinch to zoom
      const ids = Array.from(activePointers.keys());
      const p1 = activePointers.get(ids[0]!);
      const p2 = activePointers.get(ids[1]!);
      if (p1 && p2) {
        const currentDistance = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (initialPinchDistance > 0) {
          const ratio = currentDistance / initialPinchDistance;
          const newZoom = Math.min(
            MAX_MONITOR_ZOOM,
            Math.max(MIN_MONITOR_ZOOM, initialPinchZoom * ratio),
          );

          // Adjust pan to zoom into the center of the pinch
          const el = input.viewportEl.value;
          if (el) {
            const rect = el.getBoundingClientRect();
            const vpCx = rect.width / 2;
            const vpCy = rect.height / 2;
            const cx = initialPinchCenter.x - rect.left - vpCx;
            const cy = initialPinchCenter.y - rect.top - vpCy;

            const scale = newZoom / initialPinchZoom;
            panX.value = cx + (initialPinchPan.x - cx) * scale;
            panY.value = cy + (initialPinchPan.y - cy) * scale;
            zoom.value = newZoom;
          }
        }
      }
      return;
    }

    if (isVolumeAdjusting.value) {
      if (event.pointerType === 'touch') {
        event.preventDefault();
      }
      const rect = input.viewportEl.value?.getBoundingClientRect();
      if (rect) {
        const dy = volumeStartY.value - event.clientY;
        // Adjust sensitivity: 150px = 100% volume change
        const delta = dy / 150;
        const nextVolume = Math.min(2, Math.max(0, initialVolume.value + delta));
        uiStore.monitorVolume = nextVolume;
        if (uiStore.monitorMuted && delta > 0) {
          uiStore.monitorMuted = false;
        }
      }
      return;
    }

    if (!isPanning.value) return;
    const dx = event.clientX - panStart.value.x;
    const dy = event.clientY - panStart.value.y;
    panX.value = panOrigin.value.x + dx;
    panY.value = panOrigin.value.y + dy;
  }

  function stopPan(event?: PointerEvent) {
    if (event) {
      activePointers.delete(event.pointerId);
      try {
        (event.currentTarget as HTMLElement | null)?.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    } else {
      activePointers.clear();
    }

    if (!event || event.pointerId === volumeTrackerId.value || activePointers.size === 0) {
      isVolumeAdjusting.value = false;
      volumeTrackerId.value = null;
    }

    if (activePointers.size < 2) {
      initialPinchDistance = 0;
    }

    if (activePointers.size === 0) {
      isPanning.value = false;
    } else if (activePointers.size === 1) {
      // Resume panning with the remaining pointer
      const remainingId = Array.from(activePointers.keys())[0];
      if (remainingId !== undefined) {
        const p = activePointers.get(remainingId);
        if (p) {
          panStart.value = { x: p.x, y: p.y };
          panOrigin.value = { x: panX.value, y: panY.value };
        }
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

  watch(
    () => uiStore.monitorZoomFitTrigger,
    (timestamp) => {
      if (!timestamp) return;
      fitMonitor();
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
    fitMonitor,
    onPreviewPointerDown,
    onViewportPointerDown,
    onViewportPointerMove,
    onViewportAuxClick,
    onViewportDoubleClick,
    stopPan,
    onViewportWheel,
    onViewportContextMenu,
  };
}
