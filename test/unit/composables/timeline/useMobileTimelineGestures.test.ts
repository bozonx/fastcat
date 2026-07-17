/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, ref } from 'vue';
import { useMobileTimelineGestures } from '~/composables/timeline/useMobileTimelineGestures';
import type { TimelineClipActionPayload } from '~/timeline/types';

const mockTimelineStore = {
  currentTime: 0,
  timelineZoom: 100,
  duration: 10_000_000,
  markers: [],
  selectionRange: null,
  timelineDoc: { tracks: [] },
  setCurrentTimeTicks: vi.fn(),
  selectTimelineProperties: vi.fn(),
};

const mockWorkspaceStore = {
  userSettings: {
    timeline: {
      snapThresholdPx: 8,
      snapping: true,
    },
  },
};

const mockTimelineSettingsStore = {
  toolbarSnapMode: true,
};

const mockSelectionStore = {
  selectedEntity: null,
};

const mockToast = {
  add: vi.fn(),
};

const mockI18n = {
  t: vi.fn((key: string) => key),
};

vi.mock('@nuxt/ui', () => ({
  useToast: () => mockToast,
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));
vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));
vi.mock('~/stores/timeline-settings.store', () => ({
  useTimelineSettingsStore: () => mockTimelineSettingsStore,
}));
vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => mockSelectionStore,
}));
vi.mock('vue-i18n', () => ({
  useI18n: () => mockI18n,
}));

function createOptions() {
  const scrollEl = ref(document.createElement('div'));
  const isLongPress = ref(false);
  const isToolbarTrimActive = ref(false);
  const isMultiSelectionMode = computed(() => false);
  const trackHeights = computed(() => ({}) as Record<string, number>);
  const draggingMode = ref<string | null>(null);
  const suppressDrawerSelectionClearTemporarily = vi.fn((cb) => cb?.());
  const toggleMobileClipSelection = vi.fn();
  const enterMobileMultiSelection = vi.fn();
  const selectItem = vi.fn();
  const startMoveItem = vi.fn();
  const startTrimItem = vi.fn();
  const onGlobalPointerMove = vi.fn();
  const onGlobalPointerUp = vi.fn();
  const updateEdgeScroll = vi.fn();
  const stopEdgeScroll = vi.fn();
  const clearScrollRectCache = vi.fn();
  const getCachedScrollRect = vi.fn(() => ({
    top: 0,
    left: 0,
    width: 1000,
    height: 800,
    right: 1000,
    bottom: 800,
  }));
  const applyClipAction = vi.fn();

  return {
    scrollEl,
    isLongPress,
    isToolbarTrimActive,
    isMultiSelectionMode,
    trackHeights,
    draggingMode,
    suppressDrawerSelectionClearTemporarily,
    toggleMobileClipSelection,
    enterMobileMultiSelection,
    selectItem,
    startMoveItem,
    startTrimItem,
    onGlobalPointerMove,
    onGlobalPointerUp,
    updateEdgeScroll,
    stopEdgeScroll,
    clearScrollRectCache,
    getCachedScrollRect,
    applyClipAction,
  };
}

describe('useMobileTimelineGestures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures pointer coordinates and last pointer type on pointer down', () => {
    const options = createOptions();
    const { onTimelinePointerDownCapture, clickStartX, clickStartY, lastPointerType } =
      useMobileTimelineGestures(options as any);

    const event = new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 200,
      pointerType: 'touch',
    });
    onTimelinePointerDownCapture(event);

    expect(clickStartX.value).toBe(100);
    expect(clickStartY.value).toBe(200);
    expect(lastPointerType.value).toBe('touch');
    expect(options.isLongPress.value).toBe(false);
  });

  it('selects item on touch tap', () => {
    const options = createOptions();
    const { handleMobileTimelineItemSelect, lastPointerType } = useMobileTimelineGestures(
      options as any,
    );

    lastPointerType.value = 'touch';
    const event = new PointerEvent('pointerup', { pointerType: 'touch' });
    handleMobileTimelineItemSelect(event, 'item-1');

    expect(options.selectItem).toHaveBeenCalledWith(event, 'item-1');
  });

  it('does not select item after a long press', () => {
    const options = createOptions();
    const { handleMobileTimelineItemSelect, lastPointerType } = useMobileTimelineGestures(
      options as any,
    );

    lastPointerType.value = 'touch';
    options.isLongPress.value = true;
    const event = new PointerEvent('pointerup', { pointerType: 'touch' });
    handleMobileTimelineItemSelect(event, 'item-1');

    expect(options.selectItem).not.toHaveBeenCalled();
    expect(options.isLongPress.value).toBe(false);
  });

  it('handles long press by entering multi selection', () => {
    const options = createOptions();
    const { handleMobileTimelineItemLongPress } = useMobileTimelineGestures(options as any);

    handleMobileTimelineItemLongPress('item-1');

    expect(options.isLongPress.value).toBe(true);
    expect(options.enterMobileMultiSelection).toHaveBeenCalledWith('item-1');
  });

  it('forwards pointer move when trim toolbar is not active', () => {
    const options = createOptions();
    const { onMobilePointerMove } = useMobileTimelineGestures(options as any);

    const event = new PointerEvent('pointermove', { clientX: 50, clientY: 100 });
    onMobilePointerMove(event);

    expect(options.onGlobalPointerMove).toHaveBeenCalledWith(event);
    expect(options.updateEdgeScroll).toHaveBeenCalledWith(event);
  });

  it('ignores pointer move when trim toolbar is active', () => {
    const options = createOptions();
    options.isToolbarTrimActive.value = true;
    const { onMobilePointerMove } = useMobileTimelineGestures(options as any);

    const event = new PointerEvent('pointermove', { clientX: 50, clientY: 100 });
    onMobilePointerMove(event);

    expect(options.onGlobalPointerMove).not.toHaveBeenCalled();
    expect(options.updateEdgeScroll).not.toHaveBeenCalled();
  });

  it('stops edge scroll and cleans up on pointer up', () => {
    const options = createOptions();
    const { onMobilePointerUp } = useMobileTimelineGestures(options as any);

    const event = new PointerEvent('pointerup');
    onMobilePointerUp(event);

    expect(options.clearScrollRectCache).toHaveBeenCalled();
    expect(options.stopEdgeScroll).toHaveBeenCalled();
    expect(options.onGlobalPointerUp).toHaveBeenCalledWith(event);
  });

  it('delegates clip actions and swallows errors', async () => {
    const options = createOptions();
    options.applyClipAction.mockRejectedValue(new Error('boom'));
    const { onClipAction } = useMobileTimelineGestures(options as any);

    const payload = {
      action: 'freezeFrame',
      trackId: 't1',
      itemId: 'c1',
    } as TimelineClipActionPayload;

    await expect(onClipAction(payload)).resolves.toBeUndefined();
    expect(options.applyClipAction).toHaveBeenCalledWith(payload);
  });
});
