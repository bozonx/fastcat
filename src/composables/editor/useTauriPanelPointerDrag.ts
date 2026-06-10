import { isTauriRuntime } from '~/utils/runtime';

export interface TauriPanelPointerDragCallbacks {
  onDragStart: (panelId: string) => void;
  onDragOver: (
    panelId: string | null,
    position: 'left' | 'right' | 'top' | 'bottom' | null,
  ) => void;
  onDrop: (panelId: string, position: 'left' | 'right' | 'top' | 'bottom') => void;
  onDragEnd: () => void;
}

const DRAG_THRESHOLD_PX = 5;

function getDropPosition(
  rect: DOMRect,
  x: number,
  y: number,
): 'left' | 'right' | 'top' | 'bottom' | null {
  const distLeft = x - rect.left;
  const distRight = rect.right - x;
  const distTop = y - rect.top;
  const distBottom = rect.bottom - y;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);
  const threshold = Math.min(rect.width * 0.15, rect.height * 0.15, 60);

  if (minDist > threshold) {
    return null;
  }
  if (minDist === distLeft) return 'left';
  if (minDist === distRight) return 'right';
  if (minDist === distTop) return 'top';
  return 'bottom';
}

function findPanelUnderPointer(
  clientX: number,
  clientY: number,
): { panelId: string | null; rect: DOMRect | null } {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return { panelId: null, rect: null };
  const panelEl = el.closest('[data-panel-id]');
  if (!panelEl) return { panelId: null, rect: null };
  const panelId = panelEl.getAttribute('data-panel-id');
  if (!panelId) return { panelId: null, rect: null };
  return { panelId, rect: panelEl.getBoundingClientRect() };
}

export function useTauriPanelPointerDrag(callbacks: TauriPanelPointerDragCallbacks) {
  if (!isTauriRuntime()) {
    return { startDrag: () => {} };
  }

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let draggingPanelId: string | null = null;

  function onPointerMove(e: PointerEvent) {
    if (!isDragging) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) <= DRAG_THRESHOLD_PX) {
        return;
      }
      isDragging = true;
      document.body.style.cursor = 'grabbing';
      callbacks.onDragStart(draggingPanelId!);
    }

    const { panelId, rect } = findPanelUnderPointer(e.clientX, e.clientY);
    if (panelId && panelId !== draggingPanelId && rect) {
      const position = getDropPosition(rect, e.clientX, e.clientY);
      callbacks.onDragOver(panelId, position);
    } else {
      callbacks.onDragOver(null, null);
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (isDragging) {
      const { panelId, rect } = findPanelUnderPointer(e.clientX, e.clientY);
      if (panelId && panelId !== draggingPanelId && rect) {
        const position = getDropPosition(rect, e.clientX, e.clientY);
        if (position) {
          callbacks.onDrop(panelId, position);
        }
      }
      callbacks.onDragEnd();
    }

    isDragging = false;
    draggingPanelId = null;
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }

  function startDrag(e: PointerEvent, panelId: string) {
    if (e.button !== 0) return;

    startX = e.clientX;
    startY = e.clientY;
    draggingPanelId = panelId;

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  return { startDrag };
}
