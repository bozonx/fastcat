/** @vitest-environment happy-dom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { usePullToRefresh } from '~/composables/file-manager/usePullToRefresh';

/**
 * Builds a minimal TouchEvent-like object. The composable reads `currentTarget`,
 * `touches[0].clientY` and `preventDefault`, which we provide explicitly because
 * `currentTarget` is only populated during a real DOM dispatch.
 */
function createTouchEvent(clientY: number, target: { scrollTop: number }) {
  return {
    currentTarget: target as unknown as HTMLElement,
    touches: [{ clientY }],
    preventDefault: vi.fn(),
  } as unknown as TouchEvent;
}

describe('usePullToRefresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts pulling when touch begins at the top of the container', () => {
    const onRefresh = vi.fn(async () => {});
    const { isPulling, pullDistance, onTouchStart } = usePullToRefresh(onRefresh);
    const target = { scrollTop: 0 };

    onTouchStart(createTouchEvent(100, target));

    expect(isPulling.value).toBe(true);
    expect(pullDistance.value).toBe(0);
  });

  it('does not start pulling when the container is already scrolled', () => {
    const onRefresh = vi.fn(async () => {});
    const { isPulling, onTouchStart } = usePullToRefresh(onRefresh);

    onTouchStart(createTouchEvent(100, { scrollTop: 10 }));

    expect(isPulling.value).toBe(false);
  });

  it('updates pull distance with the 0.5 damping factor while moving down', () => {
    const onRefresh = vi.fn(async () => {});
    const { pullDistance, onTouchStart, onTouchMove } = usePullToRefresh(onRefresh);
    const target = { scrollTop: 0 };

    onTouchStart(createTouchEvent(100, target));
    onTouchMove(createTouchEvent(180, target));

    expect(pullDistance.value).toBe(40);
  });

  it('caps the pull distance at the maximum value', () => {
    const onRefresh = vi.fn(async () => {});
    const { pullDistance, onTouchStart, onTouchMove } = usePullToRefresh(onRefresh);
    const target = { scrollTop: 0 };

    onTouchStart(createTouchEvent(100, target));
    onTouchMove(createTouchEvent(500, target));

    expect(pullDistance.value).toBe(120);
  });

  it('does not pull when moving upward', () => {
    const onRefresh = vi.fn(async () => {});
    const { pullDistance, onTouchStart, onTouchMove } = usePullToRefresh(onRefresh);
    const target = { scrollTop: 0 };

    onTouchStart(createTouchEvent(100, target));
    onTouchMove(createTouchEvent(50, target));

    expect(pullDistance.value).toBe(0);
  });

  it('aborts pulling if the container scrolls during the gesture', () => {
    const onRefresh = vi.fn(async () => {});
    const { isPulling, pullDistance, onTouchStart, onTouchMove } = usePullToRefresh(onRefresh);
    const target = { scrollTop: 0 };

    onTouchStart(createTouchEvent(100, target));
    target.scrollTop = 5;
    onTouchMove(createTouchEvent(120, target));

    expect(isPulling.value).toBe(false);
    expect(pullDistance.value).toBe(0);
  });

  it('calls onRefresh when the pull threshold is reached on release', async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn(async () => {});
    const { isPulling, isRefreshing, pullDistance, onTouchStart, onTouchMove, onTouchEnd } =
      usePullToRefresh(onRefresh);
    const target = { scrollTop: 0 };

    onTouchStart(createTouchEvent(100, target));
    onTouchMove(createTouchEvent(300, target));
    await onTouchEnd();

    expect(isPulling.value).toBe(false);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(isRefreshing.value).toBe(true);
    expect(pullDistance.value).toBe(0);

    vi.advanceTimersByTime(300);
    expect(isRefreshing.value).toBe(false);
  });

  it('resets distance without refreshing when the threshold is not reached', async () => {
    const onRefresh = vi.fn(async () => {});
    const { isPulling, isRefreshing, pullDistance, onTouchStart, onTouchMove, onTouchEnd } =
      usePullToRefresh(onRefresh);
    const target = { scrollTop: 0 };

    onTouchStart(createTouchEvent(100, target));
    onTouchMove(createTouchEvent(130, target));
    await onTouchEnd();

    expect(isPulling.value).toBe(false);
    expect(isRefreshing.value).toBe(false);
    expect(pullDistance.value).toBe(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('ignores touch move when not pulling', () => {
    const onRefresh = vi.fn(async () => {});
    const { pullDistance, onTouchMove } = usePullToRefresh(onRefresh);

    onTouchMove(createTouchEvent(300, { scrollTop: 0 }));

    expect(pullDistance.value).toBe(0);
  });

  it('ignores touch end when not pulling', async () => {
    const onRefresh = vi.fn(async () => {});
    const { onTouchEnd } = usePullToRefresh(onRefresh);

    await onTouchEnd();

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
