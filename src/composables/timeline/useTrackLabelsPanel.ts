import { computed, ref } from 'vue';

const LABELS_WIDTH = 200;
const EDGE_OPEN_THRESHOLD = 40;
const SNAP_THRESHOLD = LABELS_WIDTH * 0.35;
const FAST_SWIPE_VELOCITY = 0.5;

export function useTrackLabelsPanel() {
  const isOpen = ref(false);
  const isDragging = ref(false);
  const dragOffset = ref(-LABELS_WIDTH);

  const translateX = computed(() => {
    if (isDragging.value) return dragOffset.value;
    return isOpen.value ? 0 : -LABELS_WIDTH;
  });

  const backdropOpacity = computed(() =>
    Math.max(0, Math.min(0.5, ((translateX.value + LABELS_WIDTH) / LABELS_WIDTH) * 0.5)),
  );

  const panelStyle = computed(() => ({
    width: `${LABELS_WIDTH}px`,
    transform: `translateX(${translateX.value}px)`,
    transition: isDragging.value ? 'none' : 'transform 0.25s ease-out',
    willChange: 'transform',
  }));

  const backdropStyle = computed(() => ({
    backgroundColor: `rgba(0, 0, 0, ${backdropOpacity.value})`,
    pointerEvents: (!isDragging.value && isOpen.value ? 'auto' : 'none') as 'auto' | 'none',
    transition: isDragging.value ? 'none' : 'background-color 0.25s ease-out',
  }));

  function toggle() {
    isOpen.value = !isOpen.value;
  }

  function close() {
    isOpen.value = false;
  }

  // Touch gesture state
  let touchId = -1;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let initialOffset = 0;
  let directionLocked = false;
  let isHorizontal = false;

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0] as Touch;
    const fromLeftEdge = touch.clientX < EDGE_OPEN_THRESHOLD;

    if (!fromLeftEdge && !isOpen.value) return;

    touchId = touch.identifier;
    startX = touch.clientX;
    startY = touch.clientY;
    startTime = Date.now();
    initialOffset = isOpen.value ? 0 : -LABELS_WIDTH;
    directionLocked = false;
    isHorizontal = false;
    isDragging.value = true;
    dragOffset.value = initialOffset;
  }

  function onTouchMove(e: TouchEvent): boolean {
    if (!isDragging.value) return false;
    const touch = Array.from(e.touches).find((t) => t.identifier === touchId) as Touch | undefined;
    if (!touch) return false;

    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (!directionLocked) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return false;
      directionLocked = true;
      isHorizontal = Math.abs(dx) > Math.abs(dy);
      if (!isHorizontal) {
        isDragging.value = false;
        return false;
      }
    }

    if (!isHorizontal) return false;

    e.stopPropagation();
    e.preventDefault();
    dragOffset.value = Math.max(-LABELS_WIDTH, Math.min(0, initialOffset + dx));
    return true;
  }

  function onTouchEnd() {
    if (!isDragging.value) return;
    isDragging.value = false;

    const elapsed = Math.max(1, Date.now() - startTime);
    const velocity = (dragOffset.value - initialOffset) / elapsed;

    if (Math.abs(velocity) > FAST_SWIPE_VELOCITY) {
      isOpen.value = velocity > 0;
    } else {
      isOpen.value = dragOffset.value > -SNAP_THRESHOLD;
    }
  }

  return {
    isOpen,
    isDragging,
    panelStyle,
    backdropStyle,
    toggle,
    close,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
}
