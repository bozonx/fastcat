/** @vitest-environment happy-dom */
import { computed, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineItemDrag } from '~/composables/timeline/useTimelineItemDrag';
import { useToast } from '#ui/composables/useToast';

const bindSessionMock = vi.fn();
const toastAddMock = vi.fn();
vi.stubGlobal('useI18n', () => ({
  t: (key: string) => key,
}));
const clearSessionMock = vi.fn();
const scheduleUpdateMock = vi.fn((update: () => void) => update());
const historyPushMock = vi.fn();
const pushTimelineHistoryMock = vi.fn(
  (preState: unknown, commandType: string, labelKey: string) => {
    historyPushMock('timeline', commandType, preState, labelKey);
  },
);
const pasteClipsMock = vi.fn();
const requestTimelineSaveMock = vi.fn(async () => {});
// Mocks that mutate timelineStoreMock.timelineDoc so the drag flow's "did the
// doc actually change?" guard (no-op click suppression) sees a different reference.
const applyTimelineMock = vi.fn(() => {
  timelineStoreMock.timelineDoc = { ...timelineStoreMock.timelineDoc };
});
const batchApplyTimelineMock = vi.fn(() => {
  timelineStoreMock.timelineDoc = { ...timelineStoreMock.timelineDoc };
});
const selectTimelineItemsMock = vi.fn();
const selectionSelectTimelineItemsMock = vi.fn();

const timelineStoreMock = {
  selectedItemIds: [] as string[],
  timelineDoc: null as any,
  duration: 10_000_000,
  currentTime: 0,
  timelineZoom: 1,
  getMarkers: vi.fn(() => []),
  getSelectionRange: vi.fn(() => null),
  applyTimeline: applyTimelineMock,
  batchApplyTimeline: batchApplyTimelineMock,
  pushTimelineHistory: pushTimelineHistoryMock,
  selectTimelineItems: selectTimelineItemsMock,
  pasteClips: pasteClipsMock,
  requestTimelineSave: requestTimelineSaveMock,
};

const projectStoreMock = {
  currentView: 'cut',
};

const historyStoreMock = {
  push: historyPushMock,
};

const settingsStoreMock = {
  toolbarSnapMode: 'snap',
  toolbarDragModeEnabled: false,
  toolbarDragMode: 'copy',
  frameSnapMode: 'none',
  snapThresholdPx: 8,
};

const workspaceStoreMock = {
  userSettings: {
    hotkeys: {
      layer1: 'Shift',
      layer2: 'Control',
      bindings: {},
    },
    mouse: {
      timeline: {
        clipDragRight: 'copy',
        clipDragShift: 'select_area',
        clipDragCtrl: 'free_mode',
      },
    },
    timeline: {
      snapping: {
        timelineEdges: false,
        playhead: false,
        markers: false,
        clips: false,
        selection: false,
      },
    },
  },
};

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => timelineStoreMock,
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => projectStoreMock,
}));

vi.mock('~/stores/history.store', () => ({
  useHistoryStore: () => historyStoreMock,
}));

vi.mock('~/stores/timeline-settings.store', () => ({
  useTimelineSettingsStore: () => settingsStoreMock,
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => ({
    selectTimelineItems: selectionSelectTimelineItemsMock,
  }),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStoreMock,
}));

vi.mock('~/composables/timeline/useTimelinePointerSession', () => ({
  useTimelinePointerSession: () => ({
    bindSession: bindSessionMock,
    clearSession: clearSessionMock,
    scheduleUpdate: scheduleUpdateMock,
  }),
}));

describe('useTimelineItemDrag', () => {
  beforeEach(() => {
    vi.mocked(useToast).mockReturnValue({
      add: toastAddMock,
      remove: vi.fn(),
    });
    vi.clearAllMocks();
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => []),
    });

    timelineStoreMock.selectedItemIds = [];
    timelineStoreMock.timelineZoom = 50;
    settingsStoreMock.toolbarSnapMode = 'snap';
    settingsStoreMock.toolbarDragModeEnabled = false;
    settingsStoreMock.toolbarDragMode = 'copy';
    settingsStoreMock.frameSnapMode = 'none';
    settingsStoreMock.snapThresholdPx = 8;
    workspaceStoreMock.userSettings.timeline.snapping = {
      timelineEdges: false,
      playhead: false,
      markers: false,
      clips: false,
      selection: false,
    };
    timelineStoreMock.timelineDoc = {
      tracks: [
        {
          id: 'track-1',
          kind: 'video',
          locked: false,
          items: [
            {
              id: 'clip-1',
              kind: 'clip',
              clipType: 'media',
              name: 'Clip 1',
              source: { path: 'clip-1.mp4' },
              sourceRange: { startUs: 0, durationUs: 5_000_000 },
              sourceDurationUs: 5_000_000,
              timelineRange: { startUs: 1_000_000, durationUs: 5_000_000 },
              speed: 1,
              isImage: false,
              locked: false,
            },
            {
              id: 'clip-2',
              kind: 'clip',
              clipType: 'media',
              name: 'Clip 2',
              source: { path: 'clip-2.mp4' },
              sourceRange: { startUs: 0, durationUs: 2_000_000 },
              sourceDurationUs: 2_000_000,
              timelineRange: { startUs: 7_000_000, durationUs: 2_000_000 },
              speed: 1,
              isImage: false,
              locked: false,
              linkedGroupId: 'group-1',
            },
          ],
        },
        {
          id: 'track-2',
          kind: 'audio',
          locked: false,
          items: [
            {
              id: 'clip-a1',
              kind: 'clip',
              clipType: 'media',
              name: 'Clip A1',
              source: { path: 'clip-a1.wav' },
              sourceRange: { startUs: 0, durationUs: 5_000_000 },
              sourceDurationUs: 5_000_000,
              timelineRange: { startUs: 1_000_000, durationUs: 5_000_000 },
              speed: 1,
              isImage: false,
              locked: false,
              linkedGroupId: 'group-1',
            },
          ],
        },
      ],
      timebase: { fps: 30 },
    };

    selectTimelineItemsMock.mockImplementation((items: Array<{ itemId: string }>) => {
      timelineStoreMock.selectedItemIds = items.map((item) => item.itemId);
    });
  });

  it('binds global pointer handlers and copies clip on right-button drag release', async () => {
    const scrollEl = ref({
      scrollLeft: 0,
    } as HTMLElement);
    const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
    const { startMoveItem } = useTimelineItemDrag(scrollEl, tracks);

    const pointerTarget = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };

    startMoveItem(
      {
        button: 2,
        buttons: 2,
        clientX: 100,
        clientY: 20,
        pointerId: 7,
        pointerType: 'mouse',
        currentTarget: pointerTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as PointerEvent,
      {
        trackId: 'track-1',
        itemId: 'clip-1',
        startUs: 1_000_000,
        mode: 'move',
      },
    );

    expect(bindSessionMock).toHaveBeenCalledTimes(1);
    const handlers = bindSessionMock.mock.calls[0]?.[0];
    expect(handlers.onPointerMove).toBeTypeOf('function');
    expect(handlers.onPointerUp).toBeTypeOf('function');

    handlers.onPointerMove({
      buttons: 2,
      button: 2,
      clientX: 180,
      clientY: 20,
    } as PointerEvent);

    handlers.onPointerUp({
      button: 2,
      clientX: 180,
      clientY: 20,
      pointerId: 7,
      currentTarget: pointerTarget,
    } as PointerEvent);

    expect(pasteClipsMock).toHaveBeenCalledTimes(1);
    const moveCall = applyTimelineMock.mock.calls.find(([cmd]) => cmd?.type === 'move_items')?.[0];
    expect(moveCall).toBeTruthy();
    expect(pasteClipsMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          sourceTrackId: 'track-1',
          clip: expect.objectContaining({
            id: 'clip-1',
            timelineRange: expect.objectContaining({
              startUs: 1_000_000,
            }),
          }),
        }),
      ],
      expect.objectContaining({
        targetTrackId: 'track-1',
        insertStartUs: moveCall.moves[0].startUs,
      }),
    );
    expect(requestTimelineSaveMock).toHaveBeenCalledWith({ immediate: true });
  });

  it('uses preview ghosts for grouped clips and commits the move on release', () => {
    timelineStoreMock.selectedItemIds = ['clip-2', 'clip-a1'];

    const scrollEl = ref({
      scrollLeft: 0,
    } as HTMLElement);
    const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
    const { startMoveItem, movePreview } = useTimelineItemDrag(scrollEl, tracks);

    const pointerTarget = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };

    startMoveItem(
      {
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 20,
        pointerId: 11,
        pointerType: 'mouse',
        currentTarget: pointerTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as PointerEvent,
      {
        trackId: 'track-1',
        itemId: 'clip-2',
        startUs: 7_000_000,
        mode: 'move',
      },
    );

    const handlers = bindSessionMock.mock.calls[0]?.[0];

    handlers.onPointerMove({
      buttons: 1,
      button: 0,
      clientX: 120,
      clientY: 20,
    } as PointerEvent);

    expect(applyTimelineMock).not.toHaveBeenCalled();
    expect(batchApplyTimelineMock).not.toHaveBeenCalled();
    expect(movePreview.value).toEqual([
      {
        itemId: 'clip-2',
        trackId: 'track-1',
        startUs: 9_000_000,
        isCollision: false,
      },
      {
        itemId: 'clip-a1',
        trackId: 'track-2',
        startUs: 3_000_000,
        isCollision: false,
      },
    ]);

    requestTimelineSaveMock.mockImplementationOnce(async () => {
      expect(movePreview.value).toEqual([]);
    });

    handlers.onPointerUp({
      button: 0,
      clientX: 120,
      clientY: 20,
      pointerId: 11,
      currentTarget: pointerTarget,
    } as PointerEvent);

    expect(applyTimelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'move_items',
        moves: expect.arrayContaining([
          expect.objectContaining({
            fromTrackId: 'track-1',
            toTrackId: 'track-1',
            itemId: 'clip-2',
            startUs: 9_000_000,
          }),
          expect.objectContaining({
            fromTrackId: 'track-2',
            toTrackId: 'track-2',
            itemId: 'clip-a1',
            startUs: 3_000_000,
          }),
        ]),
      }),
      expect.objectContaining({
        saveMode: 'none',
        skipHistory: true,
      }),
    );
    expect(historyPushMock).toHaveBeenCalledTimes(1);
    expect(historyPushMock).toHaveBeenCalledWith(
      'timeline',
      'move_items',
      expect.anything(),
      expect.any(String),
    );
    expect(requestTimelineSaveMock).toHaveBeenCalledWith({ immediate: true });
  });

  it('snaps a dragged clip edge to another clip edge during DnD', () => {
    workspaceStoreMock.userSettings.timeline.snapping.clips = true;

    const scrollEl = ref({
      scrollLeft: 0,
    } as HTMLElement);
    const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
    const { startMoveItem, movePreview } = useTimelineItemDrag(scrollEl, tracks);

    const pointerTarget = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };

    startMoveItem(
      {
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 20,
        pointerId: 21,
        pointerType: 'mouse',
        currentTarget: pointerTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as PointerEvent,
      {
        trackId: 'track-1',
        itemId: 'clip-1',
        startUs: 1_000_000,
        mode: 'move',
      },
    );

    const handlers = bindSessionMock.mock.calls[0]?.[0];

    handlers.onPointerMove({
      buttons: 1,
      button: 0,
      clientX: 112,
      clientY: 20,
    } as PointerEvent);

    expect(movePreview.value).toEqual([
      {
        itemId: 'clip-1',
        trackId: 'track-1',
        startUs: 2_000_000,
        isCollision: false,
      },
    ]);

    handlers.onPointerUp({
      button: 0,
      clientX: 112,
      clientY: 20,
      pointerId: 21,
      currentTarget: pointerTarget,
    } as PointerEvent);

    expect(applyTimelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'move_items',
        moves: [
          expect.objectContaining({
            itemId: 'clip-1',
            startUs: 2_000_000,
          }),
        ],
      }),
      expect.objectContaining({ saveMode: 'none', skipHistory: true }),
    );
  });

  it('respects free-mode modifier by bypassing clip snap while dragging', () => {
    workspaceStoreMock.userSettings.timeline.snapping.clips = true;

    const scrollEl = ref({
      scrollLeft: 0,
    } as HTMLElement);
    const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
    const { startMoveItem, movePreview } = useTimelineItemDrag(scrollEl, tracks);

    const pointerTarget = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };

    startMoveItem(
      {
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 20,
        pointerId: 22,
        pointerType: 'mouse',
        ctrlKey: true,
        currentTarget: pointerTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as PointerEvent,
      {
        trackId: 'track-1',
        itemId: 'clip-1',
        startUs: 1_000_000,
        mode: 'move',
      },
    );

    const handlers = bindSessionMock.mock.calls[0]?.[0];

    handlers.onPointerMove({
      buttons: 1,
      button: 0,
      clientX: 112,
      clientY: 20,
      ctrlKey: true,
    } as PointerEvent);

    expect(movePreview.value[0]).toEqual(
      expect.objectContaining({
        itemId: 'clip-1',
        startUs: 2_200_000,
      }),
    );
  });

  it('includes scroll movement in the dragged clip position', () => {
    const scrollEl = ref({
      scrollLeft: 0,
    } as HTMLElement);
    const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
    const { startMoveItem, movePreview } = useTimelineItemDrag(scrollEl, tracks);

    const pointerTarget = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };

    startMoveItem(
      {
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 20,
        pointerId: 23,
        pointerType: 'mouse',
        currentTarget: pointerTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as PointerEvent,
      {
        trackId: 'track-1',
        itemId: 'clip-1',
        startUs: 1_000_000,
        mode: 'move',
      },
    );

    scrollEl.value.scrollLeft = 15;
    const handlers = bindSessionMock.mock.calls[0]?.[0];

    handlers.onPointerMove({
      buttons: 1,
      button: 0,
      clientX: 100,
      clientY: 20,
    } as PointerEvent);

    expect(movePreview.value[0]).toEqual(
      expect.objectContaining({
        itemId: 'clip-1',
        startUs: 2_500_000,
      }),
    );
  });

  it('shows trim preview during drag and commits trim only on pointer release', () => {
    const scrollEl = ref({
      scrollLeft: 0,
    } as HTMLElement);
    const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
    const { startTrimItem, trimPreview } = useTimelineItemDrag(scrollEl, tracks);

    const pointerTarget = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };

    startTrimItem(
      {
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 20,
        pointerId: 9,
        pointerType: 'mouse',
        currentTarget: pointerTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as PointerEvent,
      {
        trackId: 'track-1',
        itemId: 'clip-1',
        edge: 'start',
        startUs: 1_000_000,
      },
    );

    const handlers = bindSessionMock.mock.calls[0]?.[0];

    handlers.onPointerMove({
      buttons: 1,
      button: 0,
      clientX: 104,
      clientY: 20,
    } as PointerEvent);

    expect(applyTimelineMock).not.toHaveBeenCalled();
    expect(trimPreview.value).toEqual([
      {
        itemId: 'clip-1',
        trackId: 'track-1',
        startUs: 1_400_000,
        durationUs: 4_600_000,
        edge: 'start',
        deltaUs: 400_000,
      },
    ]);

    handlers.onPointerUp({
      button: 0,
      clientX: 104,
      clientY: 20,
      pointerId: 9,
      currentTarget: pointerTarget,
    } as PointerEvent);

    expect(applyTimelineMock).toHaveBeenCalledTimes(1);
    expect(applyTimelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'trim_item',
        trackId: 'track-1',
        itemId: 'clip-1',
        edge: 'start',
        deltaUs: 400_000,
      }),
      expect.objectContaining({
        saveMode: 'none',
        skipHistory: true,
      }),
    );
    expect(requestTimelineSaveMock).toHaveBeenCalledWith({ immediate: true });
  });

  describe('edge scroll during drag', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
    });

    function createScrollEl() {
      const el = document.createElement('div');
      let scrollLeft = 100;
      Object.defineProperty(el, 'scrollLeft', {
        get: () => scrollLeft,
        set: (v: number) => {
          scrollLeft = v;
        },
        configurable: true,
      });
      el.getBoundingClientRect = () =>
        ({
          width: 500,
          height: 300,
          top: 0,
          right: 500,
          bottom: 300,
          left: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
      return { el, getScrollLeft: () => scrollLeft };
    }

    it('scrolls left when pointer is near the left edge during move', () => {
      const { el, getScrollLeft } = createScrollEl();
      const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
      const { startMoveItem } = useTimelineItemDrag(ref(el), tracks);

      const pointerTarget = {
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn(),
      };

      startMoveItem(
        {
          button: 0,
          buttons: 1,
          clientX: 100,
          clientY: 20,
          pointerId: 1,
          pointerType: 'mouse',
          currentTarget: pointerTarget,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as PointerEvent,
        {
          trackId: 'track-1',
          itemId: 'clip-1',
          startUs: 1_000_000,
          mode: 'move',
        },
      );

      const handlers = bindSessionMock.mock.calls[0]?.[0];

      handlers.onPointerMove({
        buttons: 1,
        button: 0,
        clientX: 10,
        clientY: 20,
      } as PointerEvent);

      vi.advanceTimersByTime(100);
      expect(getScrollLeft()).toBeLessThan(100);
    });

    it('scrolls right when pointer is near the right edge during trim', () => {
      const { el, getScrollLeft } = createScrollEl();
      const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
      const { startTrimItem } = useTimelineItemDrag(ref(el), tracks);

      const pointerTarget = {
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn(),
      };

      startTrimItem(
        {
          button: 0,
          buttons: 1,
          clientX: 100,
          clientY: 20,
          pointerId: 2,
          pointerType: 'mouse',
          currentTarget: pointerTarget,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as PointerEvent,
        {
          trackId: 'track-1',
          itemId: 'clip-1',
          edge: 'end',
          startUs: 1_000_000,
        },
      );

      const handlers = bindSessionMock.mock.calls[0]?.[0];

      handlers.onPointerMove({
        buttons: 1,
        button: 0,
        clientX: 490,
        clientY: 20,
      } as PointerEvent);

      vi.advanceTimersByTime(100);
      expect(getScrollLeft()).toBeGreaterThan(100);
    });

    it('stops edge scrolling when trim end is blocked by the next clip', () => {
      const { el, getScrollLeft } = createScrollEl();
      const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
      const { startTrimItem } = useTimelineItemDrag(ref(el), tracks);

      const pointerTarget = {
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn(),
      };

      startTrimItem(
        {
          button: 0,
          buttons: 1,
          clientX: 100,
          clientY: 20,
          pointerId: 4,
          pointerType: 'touch',
          currentTarget: pointerTarget,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as PointerEvent,
        {
          trackId: 'track-1',
          itemId: 'clip-1',
          edge: 'end',
          startUs: 1_000_000,
        },
      );

      const handlers = bindSessionMock.mock.calls[0]?.[0];

      handlers.onPointerMove({
        buttons: 1,
        button: 0,
        clientX: 490,
        clientY: 20,
      } as PointerEvent);

      vi.advanceTimersByTime(16);
      const scrollAfterBlockedFrame = getScrollLeft();
      vi.advanceTimersByTime(100);

      expect(scrollAfterBlockedFrame).toBeGreaterThan(100);
      expect(getScrollLeft()).toBe(scrollAfterBlockedFrame);
    });

    it('stops scrolling when pointer moves to the center', () => {
      const { el, getScrollLeft } = createScrollEl();
      const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
      const { startMoveItem } = useTimelineItemDrag(ref(el), tracks);

      const pointerTarget = {
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn(),
      };

      startMoveItem(
        {
          button: 0,
          buttons: 1,
          clientX: 100,
          clientY: 20,
          pointerId: 3,
          pointerType: 'mouse',
          currentTarget: pointerTarget,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as PointerEvent,
        {
          trackId: 'track-1',
          itemId: 'clip-1',
          startUs: 1_000_000,
          mode: 'move',
        },
      );

      const handlers = bindSessionMock.mock.calls[0]?.[0];

      handlers.onPointerMove({
        buttons: 1,
        button: 0,
        clientX: 10,
        clientY: 20,
      } as PointerEvent);

      vi.advanceTimersByTime(16);
      const scrollAfterEdge = getScrollLeft();

      handlers.onPointerMove({
        buttons: 1,
        button: 0,
        clientX: 250,
        clientY: 20,
      } as PointerEvent);

      vi.advanceTimersByTime(16);
      expect(getScrollLeft()).toBe(scrollAfterEdge);
    });
  });

  it('trims all linkedGroupId members together using trim_items', () => {
    const scrollEl = ref({ scrollLeft: 0 } as HTMLElement);
    const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
    const { startTrimItem, trimPreview } = useTimelineItemDrag(scrollEl, tracks);

    const pointerTarget = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };

    startTrimItem(
      {
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 20,
        pointerId: 13,
        pointerType: 'mouse',
        currentTarget: pointerTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as PointerEvent,
      {
        trackId: 'track-1',
        itemId: 'clip-2',
        edge: 'start',
        startUs: 7_000_000,
      },
    );

    const handlers = bindSessionMock.mock.calls[0]?.[0];

    handlers.onPointerMove({
      buttons: 1,
      button: 0,
      clientX: 104,
      clientY: 20,
    } as PointerEvent);

    expect(trimPreview.value.length).toBe(2);
    expect(trimPreview.value.some((p) => p.itemId === 'clip-2')).toBe(true);
    expect(trimPreview.value.some((p) => p.itemId === 'clip-a1')).toBe(true);

    handlers.onPointerUp({
      button: 0,
      clientX: 104,
      clientY: 20,
      pointerId: 13,
      currentTarget: pointerTarget,
    } as PointerEvent);

    expect(applyTimelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'trim_items',
        trims: expect.arrayContaining([
          expect.objectContaining({ itemId: 'clip-2' }),
          expect.objectContaining({ itemId: 'clip-a1' }),
        ]),
      }),
      expect.objectContaining({ saveMode: 'none', skipHistory: true }),
    );
  });

  it('cancels drag session gracefully when Escape key is pressed during drag', () => {
    const scrollEl = ref({ scrollLeft: 0 } as HTMLElement);
    const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
    const { startMoveItem, movePreview } = useTimelineItemDrag(scrollEl, tracks);

    const pointerTarget = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };

    startMoveItem(
      {
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 20,
        pointerId: 10,
        currentTarget: pointerTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as PointerEvent,
      {
        trackId: 'track-1',
        itemId: 'clip-1',
        startUs: 0,
      },
    );

    const handlers = bindSessionMock.mock.calls[0]?.[0];
    handlers.onPointerMove({
      buttons: 1,
      button: 0,
      clientX: 200,
      clientY: 20,
    } as PointerEvent);

    expect(movePreview.value).not.toBeNull();

    if (handlers.onKeyDown) {
      handlers.onKeyDown({
        key: 'Escape',
        code: 'Escape',
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent);
    }

    expect(clearSessionMock).toHaveBeenCalled();
  });

  it('identifies collision when copy-dragging clip over itself and shows toast on release', () => {
    timelineStoreMock.selectedItemIds = ['clip-1'];

    const scrollEl = ref({
      scrollLeft: 0,
    } as HTMLElement);
    const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
    const { startMoveItem, movePreview } = useTimelineItemDrag(scrollEl, tracks);

    const pointerTarget = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };

    // Start drag with button = 2 (right mouse button drag, which resolves to copy)
    startMoveItem(
      {
        button: 2,
        buttons: 2,
        clientX: 100,
        clientY: 20,
        pointerId: 12,
        pointerType: 'mouse',
        currentTarget: pointerTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as PointerEvent,
      {
        trackId: 'track-1',
        itemId: 'clip-1',
        startUs: 1_000_000,
        mode: 'move',
      },
    );

    const handlers = bindSessionMock.mock.calls[0]?.[0];

    // Drag slightly so it overlaps with the original position (1_000_000)
    // clientX = 110 at zoom 50 means pxToDeltaUs(10, 50) is 10 / 50 * 1_000_000 = 200_000us
    // So new position is 1_200_000us. Since original clip is [1_000_000, 6_000_000], they overlap!
    handlers.onPointerMove({
      buttons: 2,
      button: 2,
      clientX: 110,
      clientY: 20,
    } as PointerEvent);

    expect(movePreview.value[0]?.isCollision).toBe(true);

    handlers.onPointerUp({
      button: 2,
      clientX: 110,
      clientY: 20,
      pointerId: 12,
      currentTarget: pointerTarget,
    } as PointerEvent);

    // Should NOT call pasteClips
    expect(pasteClipsMock).not.toHaveBeenCalled();

    // Should raise cannotCopyClip toast
    expect(toastAddMock).toHaveBeenCalledWith({
      title: 'fastcat.timeline.cannotCopyClip',
      color: 'error',
    });
  });

  it('does not identify collision when copy-dragging to a free space and pastes clip on release', () => {
    timelineStoreMock.selectedItemIds = ['clip-1'];

    const scrollEl = ref({
      scrollLeft: 0,
    } as HTMLElement);
    const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
    const { startMoveItem, movePreview } = useTimelineItemDrag(scrollEl, tracks);

    const pointerTarget = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };

    // Start copy-drag (button = 2)
    startMoveItem(
      {
        button: 2,
        buttons: 2,
        clientX: 100,
        clientY: 20,
        pointerId: 12,
        pointerType: 'mouse',
        currentTarget: pointerTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as PointerEvent,
      {
        trackId: 'track-1',
        itemId: 'clip-1',
        startUs: 1_000_000,
        mode: 'move',
      },
    );

    const handlers = bindSessionMock.mock.calls[0]?.[0];

    // Drag far enough (clientX = 500)
    // pxToDeltaUs(400, 50) is 8_000_000us
    // So new position is 9_000_000us. Since track-1 has clip-1 [1_000_000, 6_000_000] and clip-2 [7_000_000, 9_000_000],
    // a 5-sec clip starting at 9_000_000 will be [9_000_000, 14_000_000] which is free.
    handlers.onPointerMove({
      buttons: 2,
      button: 2,
      clientX: 500,
      clientY: 20,
    } as PointerEvent);

    expect(movePreview.value[0]?.isCollision).toBe(false);

    handlers.onPointerUp({
      button: 2,
      clientX: 500,
      clientY: 20,
      pointerId: 12,
      currentTarget: pointerTarget,
    } as PointerEvent);

    // Should call pasteClips
    expect(pasteClipsMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          clip: expect.objectContaining({ id: 'clip-1' }),
        }),
      ]),
      expect.objectContaining({
        targetTrackId: 'track-1',
        insertStartUs: 41_000_000,
      }),
    );
  });

  it('respects snap mode while copy-dragging with the right button', () => {
    // Copy-drag must honor the toolbar snap mode instead of always forcing free mode.
    // At clientX 112 with clip snap on, a normal left-drag snaps to 2_000_000, while a
    // free-mode drag lands at 2_200_000. Copy-drag (right button) must snap like the left one.
    timelineStoreMock.selectedItemIds = ['clip-1'];
    workspaceStoreMock.userSettings.timeline.snapping.clips = true;
    settingsStoreMock.toolbarSnapMode = 'snap';

    const scrollEl = ref({ scrollLeft: 0 } as HTMLElement);
    const tracks = computed(() => timelineStoreMock.timelineDoc.tracks);
    const { startMoveItem, movePreview } = useTimelineItemDrag(scrollEl, tracks);

    const pointerTarget = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };

    startMoveItem(
      {
        button: 2,
        buttons: 2,
        clientX: 100,
        clientY: 20,
        pointerId: 31,
        pointerType: 'mouse',
        currentTarget: pointerTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as PointerEvent,
      {
        trackId: 'track-1',
        itemId: 'clip-1',
        startUs: 1_000_000,
        mode: 'move',
      },
    );

    const handlers = bindSessionMock.mock.calls[0]?.[0];

    handlers.onPointerMove({
      buttons: 2,
      button: 2,
      clientX: 112,
      clientY: 20,
    } as PointerEvent);

    expect(movePreview.value[0]).toEqual(
      expect.objectContaining({
        itemId: 'clip-1',
        startUs: 2_000_000,
      }),
    );
  });
});
