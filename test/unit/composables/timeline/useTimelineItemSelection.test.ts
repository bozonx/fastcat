/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, computed } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import { useTimelineItemSelection } from '~/composables/timeline/useTimelineItemSelection';

const mockWorkspaceStore = {
  userSettings: {
    hotkeys: {
      layer1: 'Shift',
      layer2: 'Control',
    },
  },
};

const mockProjectStore = {
  currentView: 'cut',
};

const mockSelectionStore = {
  selectTimelineItems: vi.fn(),
  clearSelection: vi.fn(),
  selectedEntity: null,
};

const selectedItemIds = ref<string[]>([]);
const selectTrackMock = vi.fn();
const selectTimelineItemsMock = vi.fn((items: Array<string | { itemId: string }>) => {
  if (Array.isArray(items)) {
    if (typeof items[0] === 'string') {
      selectedItemIds.value = items as string[];
    } else {
      selectedItemIds.value = (items as { itemId: string }[]).map((i) => i.itemId);
    }
  }
});

const timelineStoreMock = {
  timelineDoc: {
    tracks: [
      {
        id: 'track-1',
        items: [
          { id: 'clip-1', kind: 'clip', linkedGroupId: 'group-a' },
          { id: 'clip-2', kind: 'clip' },
        ],
      },
      {
        id: 'track-2',
        items: [{ id: 'clip-3', kind: 'clip', linkedGroupId: 'group-a' }],
      },
    ],
  },
  get selectedItemIds() {
    return selectedItemIds.value;
  },
  set selectedItemIds(val: string[]) {
    selectedItemIds.value = val;
  },
  selectTrack: selectTrackMock,
  selectTimelineItems: selectTimelineItemsMock,
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => mockWorkspaceStore),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(() => mockProjectStore),
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: vi.fn(() => mockSelectionStore),
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: vi.fn(() => timelineStoreMock),
}));

vi.mock('~/utils/hotkeys/layerUtils', () => ({
  isLayer1Active: vi.fn((e: MouseEvent) => e.shiftKey),
  isLayer2Active: vi.fn((e: MouseEvent) => e.ctrlKey),
}));

vi.mock('~/timeline/commands/utils', () => ({
  getLinkedClipGroupItemIds: vi.fn((_doc, id) => {
    if (id === 'clip-1') return ['clip-1', 'clip-3'];
    return [id];
  }),
}));

function createMockPointerEvent(init: { shiftKey?: boolean; ctrlKey?: boolean }): PointerEvent {
  return new PointerEvent('pointerdown', {
    shiftKey: init.shiftKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
  });
}

describe('useTimelineItemSelection', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    selectedItemIds.value = [];
  });

  it('plain click selects item with its linked group', () => {
    const tracks = computed(() => [
      {
        id: 'track-1',
        items: [
          { id: 'clip-1', kind: 'clip', linkedGroupId: 'group-a' },
          { id: 'clip-2', kind: 'clip' },
        ],
      },
      {
        id: 'track-2',
        items: [{ id: 'clip-3', kind: 'clip', linkedGroupId: 'group-a' }],
      },
    ]);

    const { selectItem } = useTimelineItemSelection(tracks);
    const e = createMockPointerEvent({});

    selectItem(e, 'clip-1');

    expect(selectTrackMock).toHaveBeenCalledWith(null);
    expect(selectTimelineItemsMock).toHaveBeenCalledWith([
      { trackId: 'track-1', itemId: 'clip-1', kind: 'clip' },
      { trackId: 'track-1', itemId: 'clip-3', kind: 'clip' },
    ]);
  });

  it('layer1 click toggles whole linked group', () => {
    const tracks = computed(() => [
      {
        id: 'track-1',
        items: [{ id: 'clip-1', kind: 'clip', linkedGroupId: 'group-a' }],
      },
      {
        id: 'track-2',
        items: [{ id: 'clip-3', kind: 'clip', linkedGroupId: 'group-a' }],
      },
    ]);

    const { selectItem } = useTimelineItemSelection(tracks);

    const e = createMockPointerEvent({ shiftKey: true });
    selectItem(e, 'clip-1');

    expect(selectTimelineItemsMock).toHaveBeenCalledWith(['clip-1', 'clip-3']);
  });

  it('layer2 click exclusively selects a single item and clears previous selection', () => {
    const tracks = computed(() => [
      {
        id: 'track-1',
        items: [
          { id: 'clip-1', kind: 'clip', linkedGroupId: 'group-a' },
          { id: 'clip-2', kind: 'clip' },
        ],
      },
      {
        id: 'track-2',
        items: [{ id: 'clip-3', kind: 'clip', linkedGroupId: 'group-a' }],
      },
    ]);

    const { selectItem } = useTimelineItemSelection(tracks);
    selectedItemIds.value = ['clip-2'];

    const e = createMockPointerEvent({ ctrlKey: true });
    selectItem(e, 'clip-1');

    expect(selectTrackMock).toHaveBeenCalledWith(null);
    expect(selectTimelineItemsMock).toHaveBeenCalledWith(
      [{ trackId: 'track-1', itemId: 'clip-1', kind: 'clip' }],
      { bypassGroup: true },
    );
  });

  it('repeated layer2 click on same item keeps selection unchanged', () => {
    const tracks = computed(() => [
      {
        id: 'track-1',
        items: [{ id: 'clip-1', kind: 'clip' }],
      },
    ]);

    const { selectItem } = useTimelineItemSelection(tracks);
    selectedItemIds.value = ['clip-1'];

    const e = createMockPointerEvent({ ctrlKey: true });
    selectItem(e, 'clip-1');

    expect(selectTimelineItemsMock).toHaveBeenCalledWith(
      [{ trackId: 'track-1', itemId: 'clip-1', kind: 'clip' }],
      { bypassGroup: true },
    );
  });

  it('layer1+layer2 click toggles single item into existing selection', () => {
    const tracks = computed(() => [
      {
        id: 'track-1',
        items: [
          { id: 'clip-1', kind: 'clip' },
          { id: 'clip-2', kind: 'clip' },
        ],
      },
    ]);

    const { selectItem } = useTimelineItemSelection(tracks);
    selectedItemIds.value = ['clip-1'];

    const e = createMockPointerEvent({ shiftKey: true, ctrlKey: true });
    selectItem(e, 'clip-2');

    expect(selectTimelineItemsMock).toHaveBeenCalledWith(
      [
        { trackId: 'track-1', itemId: 'clip-1', kind: 'clip' },
        { trackId: 'track-1', itemId: 'clip-2', kind: 'clip' },
      ],
      { bypassGroup: true },
    );
  });

  it('layer1+layer2 click removes already selected single item', () => {
    const tracks = computed(() => [
      {
        id: 'track-1',
        items: [
          { id: 'clip-1', kind: 'clip' },
          { id: 'clip-2', kind: 'clip' },
        ],
      },
    ]);

    const { selectItem } = useTimelineItemSelection(tracks);
    selectedItemIds.value = ['clip-1', 'clip-2'];

    const e = createMockPointerEvent({ shiftKey: true, ctrlKey: true });
    selectItem(e, 'clip-1');

    expect(selectTimelineItemsMock).toHaveBeenCalledWith(
      [{ trackId: 'track-1', itemId: 'clip-2', kind: 'clip' }],
      { bypassGroup: true },
    );
  });
});
