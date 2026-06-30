import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  dragThresholdForPointer,
  shouldStartDragOnMove,
  touchMovedIntoScroll,
  isPrimaryPointer,
  normalizePointerType,
  DRAG_THRESHOLD_MOUSE_PX,
  DRAG_THRESHOLD_TOUCH_PX,
} from '~/composables/dnd/dndGesture';
import {
  registerDndZone,
  unregisterDndZone,
  resolveDndZoneId,
  clearDndZones,
  DND_ZONE_ATTR,
} from '~/composables/dnd/dndRegistry';

import { armPointerDnd, resetPointerDndForTest } from '~/composables/dnd/usePointerDnd';
import { isDndActive } from '~/composables/dnd/dndState';
import type { DndPayload } from '~/composables/dnd/dndTypes';

// elementFromPoint is mocked so the engine's hit-test is deterministic.
// (vi.mock is hoisted above all imports by vitest, so order here is cosmetic.)
let currentHit: Element | null = null;
vi.mock('~/utils/browser-api', () => ({
  elementFromPoint: () => currentHit,
}));

describe('dndGesture', () => {
  it('uses a larger slop for touch than mouse/pen', () => {
    expect(dragThresholdForPointer('mouse')).toBe(DRAG_THRESHOLD_MOUSE_PX);
    expect(dragThresholdForPointer('pen')).toBe(DRAG_THRESHOLD_MOUSE_PX);
    expect(dragThresholdForPointer('touch')).toBe(DRAG_THRESHOLD_TOUCH_PX);
  });

  it('starts a drag on movement only for mouse/pen, never for touch', () => {
    expect(shouldStartDragOnMove({ pointerType: 'mouse', dx: 10, dy: 0 })).toBe(true);
    expect(shouldStartDragOnMove({ pointerType: 'pen', dx: 0, dy: 10 })).toBe(true);
    expect(shouldStartDragOnMove({ pointerType: 'mouse', dx: 1, dy: 1 })).toBe(false);
    expect(shouldStartDragOnMove({ pointerType: 'touch', dx: 100, dy: 100 })).toBe(false);
  });

  it('detects a touch turning into a scroll', () => {
    expect(touchMovedIntoScroll(2, 2)).toBe(false);
    expect(touchMovedIntoScroll(40, 0)).toBe(true);
  });

  it('gates mouse drags to the primary button only', () => {
    expect(isPrimaryPointer('mouse', 0)).toBe(true);
    expect(isPrimaryPointer('mouse', 2)).toBe(false);
    expect(isPrimaryPointer('touch', 2)).toBe(true);
    expect(isPrimaryPointer('pen', 5)).toBe(true);
  });

  it('normalizes pointer types', () => {
    expect(normalizePointerType('touch')).toBe('touch');
    expect(normalizePointerType('pen')).toBe('pen');
    expect(normalizePointerType('mouse')).toBe('mouse');
    expect(normalizePointerType(undefined)).toBe('');
    expect(normalizePointerType('bogus')).toBe('');
  });
});

describe('dndRegistry.resolveDndZoneId', () => {
  beforeEach(() => clearDndZones());

  function node(attr: string | null, parent: any = null): any {
    return {
      getAttribute: (n: string) => (n === DND_ZONE_ATTR ? attr : null),
      parentElement: parent,
    };
  }

  it('returns null when no ancestor carries a registered zone id', () => {
    expect(resolveDndZoneId(node(null))).toBeNull();
    expect(resolveDndZoneId(node('unregistered'))).toBeNull();
  });

  it('walks ancestors to the nearest registered zone', () => {
    registerDndZone('zone-a', {});
    const root = node('zone-a');
    const child = node(null, root);
    const leaf = node(null, child);
    expect(resolveDndZoneId(leaf)).toBe('zone-a');
    unregisterDndZone('zone-a');
    expect(resolveDndZoneId(leaf)).toBeNull();
  });
});

describe('usePointerDnd engine', () => {
  const captureEl = {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  };

  function armEvent(over: { x: number; y: number }, pointerType = 'mouse') {
    return {
      clientX: over.x,
      clientY: over.y,
      pointerId: 1,
      pointerType,
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      currentTarget: captureEl,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent;
  }

  function dispatch(type: string, x: number, y: number, pointerType = 'mouse') {
    const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
    Object.defineProperty(e, 'pointerId', { value: 1, configurable: true });
    Object.defineProperty(e, 'pointerType', { value: pointerType, configurable: true });
    window.dispatchEvent(e);
    return e;
  }

  beforeEach(() => {
    clearDndZones();
    resetPointerDndForTest();
    currentHit = null;
    captureEl.setPointerCapture.mockClear();
    captureEl.releasePointerCapture.mockClear();
    // The engine captures on the stable document root (not the pressed element),
    // so capture survives source re-renders. jsdom lacks these methods — stub them.
    (document.documentElement as unknown as { setPointerCapture: unknown }).setPointerCapture =
      vi.fn();
    (
      document.documentElement as unknown as { releasePointerCapture: unknown }
    ).releasePointerCapture = vi.fn();
    // Run scheduled rAF callbacks synchronously for deterministic dispatch.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    resetPointerDndForTest();
    vi.unstubAllGlobals();
  });

  const payload: DndPayload = { source: 'file-manager', data: { path: '/a.mp4' } };

  it('commits on movement past threshold, dispatches enter/over, then drop, and resets', () => {
    const onEnter = vi.fn();
    const onOver = vi.fn();
    const onDrop = vi.fn();
    const onLeave = vi.fn();
    registerDndZone('zone-1', { onEnter, onOver, onLeave, onDrop });

    const zoneEl = document.createElement('div');
    zoneEl.setAttribute(DND_ZONE_ATTR, 'zone-1');
    currentHit = zoneEl;

    const onStart = vi.fn();
    const onEnd = vi.fn();
    armPointerDnd(armEvent({ x: 0, y: 0 }), { payload, onStart, onEnd });

    // Tiny move: not yet a drag.
    dispatch('pointermove', 2, 0);
    expect(isDndActive()).toBe(false);
    expect(onStart).not.toHaveBeenCalled();

    // Past threshold: commits.
    dispatch('pointermove', 20, 0);
    expect(isDndActive()).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onOver).toHaveBeenCalled();
    expect(document.documentElement.setPointerCapture).toHaveBeenCalledWith(1);

    // Release over the zone → drop + full reset.
    dispatch('pointerup', 22, 0);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith({ dropped: true, cancelled: false });
    expect(isDndActive()).toBe(false);
    expect(document.documentElement.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('treats a release before threshold as a click (no drag, no drop)', () => {
    const onDrop = vi.fn();
    registerDndZone('zone-1', { onDrop });
    const onEnd = vi.fn();

    armPointerDnd(armEvent({ x: 0, y: 0 }), { payload, onEnd });
    dispatch('pointermove', 2, 2);
    dispatch('pointerup', 2, 2);

    expect(isDndActive()).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
    // onEnd only fires for a committed drag.
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('Escape aborts the drag without dropping and resets', () => {
    const onDrop = vi.fn();
    const onLeave = vi.fn();
    registerDndZone('zone-1', { onDrop, onLeave });

    const zoneEl = document.createElement('div');
    zoneEl.setAttribute(DND_ZONE_ATTR, 'zone-1');
    currentHit = zoneEl;

    const onEnd = vi.fn();
    armPointerDnd(armEvent({ x: 0, y: 0 }), { payload, onEnd });
    dispatch('pointermove', 20, 0);
    expect(isDndActive()).toBe(true);

    const esc = new KeyboardEvent('keydown', { key: 'Escape' });
    window.dispatchEvent(esc);

    expect(onDrop).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith({ dropped: false, cancelled: true });
    expect(isDndActive()).toBe(false);
  });

  it('skips zones whose canAccept rejects the payload', () => {
    const onDrop = vi.fn();
    registerDndZone('zone-reject', { canAccept: () => false, onDrop });

    const zoneEl = document.createElement('div');
    zoneEl.setAttribute(DND_ZONE_ATTR, 'zone-reject');
    currentHit = zoneEl;

    armPointerDnd(armEvent({ x: 0, y: 0 }), { payload });
    dispatch('pointermove', 20, 0);
    dispatch('pointerup', 20, 0);

    expect(onDrop).not.toHaveBeenCalled();
  });
});
