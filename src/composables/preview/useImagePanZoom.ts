import { ref, type Ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { isSecondaryWheel, getWheelDelta, DRAG_DEADZONE_PX } from '~/utils/mouse';

interface MediaMetrics {
  naturalWidth: number;
  naturalHeight: number;
  fittedWidth: number;
  fittedHeight: number;
  fitScale: number;
}

export function useImagePanZoom(containerRef: Ref<HTMLElement | null>) {
  const workspaceStore = useWorkspaceStore();
  const scale = ref(1);
  const translateX = ref(0);
  const translateY = ref(0);
  const isDragging = ref(false);
  const dragStartX = ref(0);
  const dragStartY = ref(0);
  const middlePointerDown = ref<{ x: number; y: number; moved: boolean } | null>(null);
  const isReady = ref(false);

  function resetPan() {
    translateX.value = 0;
    translateY.value = 0;
  }

  function getMediaMetrics(): MediaMetrics | null {
    if (!containerRef.value) return null;

    const container = containerRef.value;
    const media = container.querySelector('img, video') as
      | HTMLImageElement
      | HTMLVideoElement
      | null;

    if (!media) return null;

    const naturalWidth =
      media instanceof HTMLImageElement
        ? media.naturalWidth
        : media instanceof HTMLVideoElement
          ? media.videoWidth
          : 0;

    const naturalHeight =
      media instanceof HTMLImageElement
        ? media.naturalHeight
        : media instanceof HTMLVideoElement
          ? media.videoHeight
          : 0;

    const vpW = container.clientWidth;
    const vpH = container.clientHeight;

    if (!naturalWidth || !naturalHeight || !vpW || !vpH) return null;

    const fitScale = Math.min(1, vpW / naturalWidth, vpH / naturalHeight);

    return {
      naturalWidth,
      naturalHeight,
      fittedWidth: naturalWidth * fitScale,
      fittedHeight: naturalHeight * fitScale,
      fitScale,
    };
  }

  function applyFit() {
    const metrics = getMediaMetrics();
    if (!metrics) return false;

    scale.value = 1;
    resetPan();
    isReady.value = true;

    return true;
  }

  function reset() {
    const metrics = getMediaMetrics();
    if (!metrics) {
      scale.value = 1;
      resetPan();
      isReady.value = false;
      return;
    }

    scale.value = 1 / metrics.fitScale;
    resetPan();
    isReady.value = true;
  }

  function fitToContainer() {
    if (applyFit()) return;

    scale.value = 1;
    resetPan();
    isReady.value = false;
  }

  function applyZoomAtPoint(params: { delta: number; clientX: number; clientY: number }) {
    if (!containerRef.value) return;

    const zoomFactor = params.delta < 0 ? 1.1 : 0.9;
    const newScale = Math.max(0.05, Math.min(scale.value * zoomFactor, 50));
    if (newScale === scale.value) return;

    const rect = containerRef.value.getBoundingClientRect();
    const pointerX = params.clientX - rect.left;
    const pointerY = params.clientY - rect.top;

    const currentCenterX = rect.width / 2 + translateX.value;
    const currentCenterY = rect.height / 2 + translateY.value;

    const dx = pointerX - currentCenterX;
    const dy = pointerY - currentCenterY;

    const newDx = dx * (newScale / scale.value);
    const newDy = dy * (newScale / scale.value);

    translateX.value += dx - newDx;
    translateY.value += dy - newDy;
    scale.value = newScale;
    isReady.value = true;
  }

  function onWheel(e: WheelEvent) {
    if (!containerRef.value) return;

    // Browser/trackpad pinch-to-zoom: Ctrl+wheel is a platform signal, not Modifier 2 layer.
    if (e.ctrlKey) {
      e.preventDefault();
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
      applyZoomAtPoint({ delta: e.deltaY, clientX: e.clientX, clientY: e.clientY });
      return;
    }

    if (action === 'scroll_vertical') {
      if (!isShift && !isSecondaryWheel(e)) return;
      e.preventDefault();
      translateY.value -= delta;
      return;
    }

    if (action === 'scroll_horizontal') {
      if (isSecondaryWheel(e) && !isShift) return;
      e.preventDefault();
      translateX.value -= delta;
      return;
    }
  }

  function onPointerDown(e: PointerEvent) {
    const settings = workspaceStore.userSettings.mouse.monitor;
    if (e.button !== 1) return; // Only middle button

    middlePointerDown.value = { x: e.clientX, y: e.clientY, moved: false };

    if (settings.middleDrag === 'pan') {
      e.preventDefault();
      isDragging.value = true;
      dragStartX.value = e.clientX - translateX.value;
      dragStartY.value = e.clientY - translateY.value;

      if (containerRef.value) {
        containerRef.value.setPointerCapture(e.pointerId);
      }
    }
  }

  function onAuxClick(e: MouseEvent) {
    if (e.button !== 1) return;

    if (middlePointerDown.value?.moved) {
      middlePointerDown.value = null;
      return;
    }

    middlePointerDown.value = null;

    const settings = workspaceStore.userSettings.mouse.monitor;
    const action = settings.middleClick;

    if (action === 'fit') {
      fitToContainer();
    } else if (action === 'reset_zoom' || action === 'reset_zoom_center') {
      reset();
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (middlePointerDown.value) {
      const dx = e.clientX - middlePointerDown.value.x;
      const dy = e.clientY - middlePointerDown.value.y;
      if (Math.abs(dx) > DRAG_DEADZONE_PX || Math.abs(dy) > DRAG_DEADZONE_PX) {
        middlePointerDown.value.moved = true;
      }
    }

    if (!isDragging.value) return;
    translateX.value = e.clientX - dragStartX.value;
    translateY.value = e.clientY - dragStartY.value;
  }

  function onPointerUp(e: PointerEvent) {
    if (!isDragging.value) return;
    isDragging.value = false;

    if (containerRef.value) {
      containerRef.value.releasePointerCapture(e.pointerId);
    }
  }

  function onCustomZoom(e: CustomEvent<{ dir: number }>) {
    if (!containerRef.value) return;
    const zoomFactor = e.detail.dir > 0 ? 1.1 : 0.9;
    const newScale = Math.max(0.05, Math.min(scale.value * zoomFactor, 50));
    scale.value = newScale;
  }

  function onCustomZoomReset() {
    reset();
  }

  return {
    scale,
    translateX,
    translateY,
    isReady,
    reset,
    fitToContainer,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onAuxClick,
    onCustomZoom,
    onCustomZoomReset,
  };
}
