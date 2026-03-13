import { ref, computed } from 'vue';
import type { Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useSelectionStore } from '~/stores/selection.store';

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function useFileBrowserMarquee({
  rootContainer,
  sortedEntries,
  onFocusPanel,
}: {
  rootContainer: Ref<HTMLElement | null>;
  sortedEntries: Ref<FsEntry[]>;
  onFocusPanel: () => void;
}) {
  const selectionStore = useSelectionStore();

  const isMarqueeSelecting = ref(false);
  const marqueeStart = ref<{ x: number; y: number } | null>(null);
  const marqueeCurrent = ref<{ x: number; y: number } | null>(null);
  const preventClickClear = ref(false);

  const marqueeRect = computed(() => {
    if (!isMarqueeSelecting.value || !marqueeStart.value || !marqueeCurrent.value) return null;
    const x1 = marqueeStart.value.x;
    const y1 = marqueeStart.value.y;
    const x2 = marqueeCurrent.value.x;
    const y2 = marqueeCurrent.value.y;
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x1 - x2),
      height: Math.abs(y1 - y2),
    };
  });

  const marqueeStyle = computed(() => {
    const r = marqueeRect.value;
    if (!r) return null;
    return {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    };
  });

  function getPointInScrollContainer(e: PointerEvent, container: HTMLElement) {
    const rect = container.getBoundingClientRect();
    return {
      x: e.clientX - rect.left + container.scrollLeft,
      y: e.clientY - rect.top + container.scrollTop,
    };
  }

  function rectsIntersect(a: Rect, b: Rect): boolean {
    return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
  }

  function selectEntriesInMarquee() {
    const container = rootContainer.value;
    const r = marqueeRect.value;
    if (!container || !r) return;

    const selRect: Rect = {
      left: r.left,
      top: r.top,
      right: r.left + r.width,
      bottom: r.top + r.height,
    };

    const nodes = Array.from(container.querySelectorAll<HTMLElement>('[data-entry-path]'));
    const byPath = new Map<string, FsEntry>();
    for (const e of sortedEntries.value) {
      if (e.path) byPath.set(e.path, e);
    }

    const selected: FsEntry[] = [];
    const containerRect = container.getBoundingClientRect();

    for (const el of nodes) {
      const path = el.dataset.entryPath;
      if (!path) continue;
      const entry = byPath.get(path);
      if (!entry) continue;

      const elRect = el.getBoundingClientRect();
      const left = elRect.left - containerRect.left + container.scrollLeft;
      const top = elRect.top - containerRect.top + container.scrollTop;
      const rect: Rect = { left, top, right: left + elRect.width, bottom: top + elRect.height };

      if (rectsIntersect(selRect, rect)) selected.push(entry);
    }

    selectionStore.selectFsEntries(selected);
  }

  function onMarqueePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const container = rootContainer.value;
    if (!container) return;

    onFocusPanel();

    const target = e.target as HTMLElement | null;
    if (target?.tagName === 'INPUT') return;
    if (target?.closest?.('[data-entry-path]')) return;

    const point = getPointInScrollContainer(e, container);
    isMarqueeSelecting.value = true;
    marqueeStart.value = point;
    marqueeCurrent.value = point;

    try {
      container.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  function onMarqueePointerMove(e: PointerEvent) {
    if (!isMarqueeSelecting.value) return;
    const container = rootContainer.value;
    if (!container) return;
    marqueeCurrent.value = getPointInScrollContainer(e, container);
    selectEntriesInMarquee();
  }

  function onMarqueePointerUp(e: PointerEvent) {
    if (!isMarqueeSelecting.value) return;
    const container = rootContainer.value;
    if (container) {
      try {
        container.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    const r = marqueeRect.value;
    if (r && (r.width > 3 || r.height > 3)) {
      preventClickClear.value = true;
      setTimeout(() => {
        preventClickClear.value = false;
      }, 0);
    }

    isMarqueeSelecting.value = false;
    marqueeStart.value = null;
    marqueeCurrent.value = null;
  }

  return {
    marqueeStyle,
    preventClickClear,
    onMarqueePointerDown,
    onMarqueePointerMove,
    onMarqueePointerUp,
  };
}
