/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useClipInteractions } from '~/composables/timeline/useClipInteractions';

describe('useClipInteractions', () => {
  const mockTrack = ref({ id: 'track-1', kind: 'video', locked: false });
  const mockItem = ref({
    id: 'clip-1',
    kind: 'clip',
    locked: false,
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
  });
  const mockSettings = ref({
    hotkeys: { layer1: 'Shift', layer2: 'Control' },
  });

  const ctx = {
    track: mockTrack as any,
    item: mockItem as any,
    canEditClipContent: ref(true),
    isTrimModeActive: ref(false),
    userSettings: mockSettings as any,
    selectTimelineItems: vi.fn(),
    trimToPlayheadLeftNoRipple: vi.fn(),
    trimToPlayheadRightNoRipple: vi.fn(),
    trimToTimeLeftNoRipple: vi.fn(),
    trimToTimeRightNoRipple: vi.fn(),
    splitClipAtPlayhead: vi.fn(),
    splitClipAtTime: vi.fn(),
    getPointerTimeUs: vi.fn(),
    emitSelectItem: vi.fn(),
    didStartDrag: ref(false),
    longPressTriggered: ref(false),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    ctx.isTrimModeActive.value = false;
    ctx.didStartDrag.value = false;
    ctx.longPressTriggered.value = false;
    ctx.getPointerTimeUs.mockReturnValue(null);
    mockTrack.value.locked = false;
    mockItem.value.locked = false;
  });

  it('handles click when NOT in trim mode', () => {
    const { onClipClick } = useClipInteractions(ctx);
    const event = new MouseEvent('click', { button: 0 });

    onClipClick(event);

    expect(ctx.emitSelectItem).toHaveBeenCalledWith(event, 'clip-1');
  });

  it('splits clip in trim mode with no modifiers', () => {
    ctx.isTrimModeActive.value = true;
    const { onClipClick } = useClipInteractions(ctx);
    const event = new MouseEvent('click', { button: 0 });

    onClipClick(event);

    expect(ctx.selectTimelineItems).toHaveBeenCalledWith(['clip-1']);
    expect(ctx.splitClipAtPlayhead).toHaveBeenCalledWith({ trackId: 'track-1', itemId: 'clip-1' });
  });

  it('splits clip in trim mode at pointer time when available', () => {
    ctx.isTrimModeActive.value = true;
    ctx.getPointerTimeUs.mockReturnValue(2_000_000);
    const { onClipClick } = useClipInteractions(ctx);
    const event = new MouseEvent('click', { button: 0 });

    onClipClick(event);

    expect(ctx.selectTimelineItems).toHaveBeenCalledWith(['clip-1']);
    expect(ctx.splitClipAtTime).toHaveBeenCalledWith(
      { trackId: 'track-1', itemId: 'clip-1' },
      2_000_000,
    );
    expect(ctx.splitClipAtPlayhead).not.toHaveBeenCalled();
  });

  it('trims left in trim mode with Shift (fallback to playhead if pointer time is null)', () => {
    ctx.isTrimModeActive.value = true;
    ctx.getPointerTimeUs.mockReturnValue(null);
    const { onClipClick } = useClipInteractions(ctx);
    const event = new MouseEvent('click', { button: 0, shiftKey: true });

    onClipClick(event);

    expect(ctx.trimToPlayheadLeftNoRipple).toHaveBeenCalledWith({
      trackId: 'track-1',
      itemId: 'clip-1',
    });
    expect(ctx.trimToTimeLeftNoRipple).not.toHaveBeenCalled();
  });

  it('trims left in trim mode with Shift at specific pointer time', () => {
    ctx.isTrimModeActive.value = true;
    ctx.getPointerTimeUs.mockReturnValue(3_000_000);
    const { onClipClick } = useClipInteractions(ctx);
    const event = new MouseEvent('click', { button: 0, shiftKey: true });

    onClipClick(event);

    expect(ctx.trimToTimeLeftNoRipple).toHaveBeenCalledWith(
      { trackId: 'track-1', itemId: 'clip-1' },
      3_000_000,
    );
    expect(ctx.trimToPlayheadLeftNoRipple).not.toHaveBeenCalled();
  });

  it('trims right in trim mode with Ctrl (fallback to playhead if pointer time is null)', () => {
    ctx.isTrimModeActive.value = true;
    ctx.getPointerTimeUs.mockReturnValue(null);
    const { onClipClick } = useClipInteractions(ctx);
    const event = new MouseEvent('click', { button: 0, ctrlKey: true });

    onClipClick(event);

    expect(ctx.trimToPlayheadRightNoRipple).toHaveBeenCalledWith({
      trackId: 'track-1',
      itemId: 'clip-1',
    });
    expect(ctx.trimToTimeRightNoRipple).not.toHaveBeenCalled();
  });

  it('trims right in trim mode with Ctrl at specific pointer time', () => {
    ctx.isTrimModeActive.value = true;
    ctx.getPointerTimeUs.mockReturnValue(7_000_000);
    const { onClipClick } = useClipInteractions(ctx);
    const event = new MouseEvent('click', { button: 0, ctrlKey: true });

    onClipClick(event);

    expect(ctx.trimToTimeRightNoRipple).toHaveBeenCalledWith(
      { trackId: 'track-1', itemId: 'clip-1' },
      7_000_000,
    );
    expect(ctx.trimToPlayheadRightNoRipple).not.toHaveBeenCalled();
  });

  it('does nothing in trim mode if clip is locked', () => {
    ctx.isTrimModeActive.value = true;
    mockItem.value.locked = true;
    const { onClipClick } = useClipInteractions(ctx);
    const event = new MouseEvent('click', { button: 0 });

    onClipClick(event);

    expect(ctx.splitClipAtPlayhead).not.toHaveBeenCalled();
  });
});
