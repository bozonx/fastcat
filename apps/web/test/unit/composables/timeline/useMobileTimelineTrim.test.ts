/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, ref } from 'vue';
import type { TimelineClipItem } from '~/timeline/types';
import { useMobileTimelineTrim } from '~/composables/timeline/useMobileTimelineTrim';

describe('useMobileTimelineTrim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const selectedClipContext = computed(() => ({
    clip: {
      timelineRange: { startTicks: 1_000_000 },
    },
  }));
  const startTrimItem = vi.fn();
  const onGlobalPointerMove = vi.fn();
  const onGlobalPointerUp = vi.fn();
  const draggingMode = ref('trim');

  it('starts trim via synthetic pointer event from toolbar', () => {
    const { isToolbarTrimActive, onTrimToolbarStart } = useMobileTimelineTrim({
      selectedClipContext,
      startTrimItem,
      onGlobalPointerMove,
      onGlobalPointerUp,
      draggingMode,
    });

    onTrimToolbarStart({
      trackId: 't1',
      itemId: 'c1',
      edge: 'start',
      clientX: 100,
      clientY: 200,
    });

    expect(isToolbarTrimActive.value).toBe(true);
    expect(startTrimItem).toHaveBeenCalledOnce();
    const [event, input] = startTrimItem.mock.calls[0];
    expect(event).toBeInstanceOf(PointerEvent);
    expect(event.pointerType).toBe('touch');
    expect(input).toEqual({
      trackId: 't1',
      itemId: 'c1',
      edge: 'start',
      startTicks: 1_000_000,
      followTrimEdge: true,
    });
  });

  it('does nothing when there is no selected clip context', () => {
    const emptyContext = computed(() => null);
    const { isToolbarTrimActive, onTrimToolbarStart } = useMobileTimelineTrim({
      selectedClipContext: emptyContext,
      startTrimItem,
      onGlobalPointerMove,
      onGlobalPointerUp,
      draggingMode,
    });

    onTrimToolbarStart({
      trackId: 't1',
      itemId: 'c1',
      edge: 'start',
      clientX: 100,
      clientY: 200,
    });

    expect(isToolbarTrimActive.value).toBe(false);
    expect(startTrimItem).not.toHaveBeenCalled();
  });

  it('forwards move events while dragging', () => {
    const { onTrimToolbarMove } = useMobileTimelineTrim({
      selectedClipContext,
      startTrimItem,
      onGlobalPointerMove,
      onGlobalPointerUp,
      draggingMode,
    });

    onTrimToolbarMove({ clientX: 150, clientY: 250 });

    expect(onGlobalPointerMove).toHaveBeenCalledOnce();
    expect(onGlobalPointerMove.mock.calls[0][0]).toBeInstanceOf(PointerEvent);
  });

  it('ends trim and clears toolbar trim flag', () => {
    const { isToolbarTrimActive, onTrimToolbarStart, onTrimToolbarEnd } = useMobileTimelineTrim({
      selectedClipContext,
      startTrimItem,
      onGlobalPointerMove,
      onGlobalPointerUp,
      draggingMode,
    });

    onTrimToolbarStart({ trackId: 't1', itemId: 'c1', edge: 'end', clientX: 100, clientY: 200 });
    onTrimToolbarEnd({ clientX: 150, clientY: 250 });

    expect(isToolbarTrimActive.value).toBe(false);
    expect(onGlobalPointerUp).toHaveBeenCalledOnce();
  });
});
