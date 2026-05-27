import { ref } from 'vue';

const PULL_THRESHOLD = 80;
const MAX_PULL_DISTANCE = 120;

export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const isPulling = ref(false);
  const pullDistance = ref(0);
  const isRefreshing = ref(false);

  let startY = 0;
  let currentY = 0;
  let startScrollTop = 0;

  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;

    const target = event.currentTarget as HTMLElement;
    startScrollTop = target.scrollTop;
    if (startScrollTop > 0) return;

    startY = touch.clientY;
    currentY = startY;
    isPulling.value = true;
    pullDistance.value = 0;
  }

  function onTouchMove(event: TouchEvent) {
    if (!isPulling.value) return;

    const touch = event.touches[0];
    if (!touch) return;

    const target = event.currentTarget as HTMLElement;
    if (target.scrollTop > 0) {
      isPulling.value = false;
      pullDistance.value = 0;
      return;
    }

    currentY = touch.clientY;
    const delta = currentY - startY;

    if (delta > 0) {
      event.preventDefault();
      pullDistance.value = Math.min(delta * 0.5, MAX_PULL_DISTANCE);
    }
  }

  async function onTouchEnd() {
    if (!isPulling.value) return;
    isPulling.value = false;

    if (pullDistance.value >= PULL_THRESHOLD && !isRefreshing.value) {
      isRefreshing.value = true;
      try {
        await onRefresh();
      } finally {
        isRefreshing.value = false;
      }
    }

    pullDistance.value = 0;
  }

  return {
    isPulling,
    pullDistance,
    isRefreshing,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
}
