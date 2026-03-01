import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

export function useMonitorGestures(input: { projectStore: ReturnType<typeof useProjectStore> }) {
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

  const workspaceStyle = computed(() => {
    return {
      transform: `translate(${panX.value}px, ${panY.value}px)`,
    };
  });

  function centerMonitor() {
    if (!input.projectStore.projectSettings.monitor) return;
    input.projectStore.projectSettings.monitor.panX = 0;
    input.projectStore.projectSettings.monitor.panY = 0;
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
    workspaceStyle,
    centerMonitor,
    onPreviewPointerDown,
    onViewportPointerDown,
    onViewportPointerMove,
    stopPan,
    onViewportWheel,
  };
}
