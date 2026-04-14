/** @vitest-environment happy-dom */
import { computed, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineItemDrag } from '~/composables/timeline/useTimelineItemDrag';

const bindSessionMock = vi.fn();
const clearSessionMock = vi.fn();
const scheduleUpdateMock = vi.fn((update: () => void) => update());
const historyPushMock = vi.fn();
const pasteClipsMock = vi.fn();
const requestTimelineSaveMock = vi.fn(async () => {});
const applyTimelineMock = vi.fn();
const batchApplyTimelineMock = vi.fn();
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
  overlapMode: 'replace',
};

const workspaceStoreMock = {
  userSettings: {
    hotkeys: {
      layer1: 'Shift',
      layer2: 'Control',
    },
    mouse: {
      timeline: {
        clipDragRight: 'copy',
        clipDragShift: 'toggle_clip_move_mode',
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
    vi.clearAllMocks();
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => []),
    });

    timelineStoreMock.selectedItemIds = [];
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

    handlers.onPointerMove(
      {
        buttons: 2,
        button: 2,
        clientX: 180,
        clientY: 20,
      } as PointerEvent,
    );

    handlers.onPointerUp(
      {
        button: 2,
        clientX: 180,
        clientY: 20,
        pointerId: 7,
        currentTarget: pointerTarget,
      } as PointerEvent,
    );

    expect(pasteClipsMock).toHaveBeenCalledTimes(1);
    expect(pasteClipsMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          sourceTrackId: 'track-1',
          clip: expect.objectContaining({
            id: 'clip-1',
          }),
        }),
      ],
      expect.objectContaining({
        targetTrackId: 'track-1',
      }),
    );
    expect(requestTimelineSaveMock).toHaveBeenCalledWith({ immediate: true });
  });
});
