export function useScrollRectCache() {
  let cachedScrollRectEl: HTMLElement | null = null;
  let cachedScrollRect: DOMRect | null = null;
  let scrollRectFrameId = 0;

  function clearScrollRectCache() {
    cachedScrollRectEl = null;
    cachedScrollRect = null;

    if (scrollRectFrameId !== 0) {
      cancelAnimationFrame(scrollRectFrameId);
      scrollRectFrameId = 0;
    }
  }

  function getCachedScrollRect(el: HTMLElement): DOMRect {
    if (cachedScrollRectEl === el && cachedScrollRect) {
      return cachedScrollRect;
    }

    cachedScrollRectEl = el;
    cachedScrollRect = el.getBoundingClientRect();

    if (scrollRectFrameId === 0) {
      scrollRectFrameId = requestAnimationFrame(() => {
        scrollRectFrameId = 0;
        cachedScrollRectEl = null;
        cachedScrollRect = null;
      });
    }

    return cachedScrollRect;
  }

  return {
    clearScrollRectCache,
    getCachedScrollRect,
  };
}
