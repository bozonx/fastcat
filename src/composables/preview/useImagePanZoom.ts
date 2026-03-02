import { ref, type Ref } from 'vue';

export function useImagePanZoom(containerRef: Ref<HTMLElement | null>) {
  const scale = ref(1);
  const translateX = ref(0);
  const translateY = ref(0);
  const isDragging = ref(false);
  const dragStartX = ref(0);
  const dragStartY = ref(0);

  function reset() {
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
  }

  function onWheel(e: WheelEvent) {
    if (!containerRef.value) return;
    e.preventDefault();

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.05, Math.min(scale.value * zoomFactor, 50));
    if (newScale === scale.value) return;

    const rect = containerRef.value.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;

    // Current image center relative to container
    const currentCenterX = rect.width / 2 + translateX.value;
    const currentCenterY = rect.height / 2 + translateY.value;

    // Distance from pointer to center
    const dx = pointerX - currentCenterX;
    const dy = pointerY - currentCenterY;

    // New distance from pointer to center
    const newDx = dx * (newScale / scale.value);
    const newDy = dy * (newScale / scale.value);

    translateX.value += dx - newDx;
    translateY.value += dy - newDy;
    scale.value = newScale;
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 1) return; // Only middle button
    e.preventDefault();
    isDragging.value = true;
    dragStartX.value = e.clientX - translateX.value;
    dragStartY.value = e.clientY - translateY.value;

    if (containerRef.value) {
      containerRef.value.setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e: PointerEvent) {
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

  return {
    scale,
    translateX,
    translateY,
    reset,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
