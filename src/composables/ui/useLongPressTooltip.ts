import { ref, onBeforeUnmount } from 'vue';

const LONG_PRESS_MS = 500;
const MOVE_THRESHOLD_PX = 10;

export function useLongPressTooltip() {
  const tooltipText = ref('');
  const tooltipVisible = ref(false);
  const tooltipX = ref(0);
  const tooltipY = ref(0);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function hide() {
    tooltipVisible.value = false;
    clearTimer();
  }

  function startPress(e: PointerEvent, text: string) {
    if (!text) return;
    startX = e.clientX;
    startY = e.clientY;
    clearTimer();
    timer = setTimeout(() => {
      tooltipText.value = text;
      tooltipX.value = e.clientX;
      tooltipY.value = e.clientY;
      tooltipVisible.value = true;
      if (navigator.vibrate) navigator.vibrate(30);
      timer = null;
    }, LONG_PRESS_MS);
  }

  function movePress(e: PointerEvent) {
    if (timer === null) return;
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (dx > MOVE_THRESHOLD_PX || dy > MOVE_THRESHOLD_PX) {
      clearTimer();
    }
  }

  onBeforeUnmount(() => {
    clearTimer();
  });

  return {
    tooltipText,
    tooltipVisible,
    tooltipX,
    tooltipY,
    startPress,
    movePress,
    hide,
  };
}
