import { describe, expect, it, vi, beforeEach } from 'vitest';
import { reactive, nextTick } from 'vue';
import type { TimelineTrack, TimelineClipActionPayload } from '~/timeline/types';

const mockUiStore = reactive({
  openAutoMontageTrigger: null as { itemIds: string[]; timestamp: number } | null,
});

const mockSelectionStore = {
  selectedEntity: null as any,
};

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => mockUiStore,
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => mockSelectionStore,
}));

const mockApplySilenceTrimming = vi.fn();

vi.mock('~/composables/timeline/useSilenceTrimming', () => ({
  useSilenceTrimming: () => ({
    applySilenceTrimming: mockApplySilenceTrimming,
  }),
}));

function makeTrack(items: any[], overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'v1',
    kind: 'video',
    name: 'Video 1',
    items,
    ...overrides,
  } as TimelineTrack;
}

function makeClip(id: string): any {
  return {
    id,
    kind: 'clip',
    clipType: 'media',
    trackId: 'v1',
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
  };
}

describe('useTimelineAutoMontage', () => {
  let result: {
    autoMontageModal: { value: { open: boolean; itemIds: string[] } | null };
    applyAutoMontage: (settings: { trimStart: boolean; trimEnd: boolean; trimMiddle: boolean; mode: 'cut' | 'mark' }) => Promise<void>;
    openAutoMontage: (payload: TimelineClipActionPayload) => void;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockUiStore.openAutoMontageTrigger = null;
    mockSelectionStore.selectedEntity = null;

    const { useTimelineAutoMontage } = await import('~/composables/timeline/useTimelineAutoMontage');
    result = useTimelineAutoMontage(() => [makeTrack([makeClip('c1'), makeClip('c2')])]);
  });

  it('openAutoMontage opens modal with single item when no selection', () => {
    mockSelectionStore.selectedEntity = null;

    result.openAutoMontage({
      action: 'openAutoMontage',
      trackId: 'v1',
      itemId: 'c1',
    });

    expect(result.autoMontageModal.value).toEqual({
      open: true,
      itemIds: ['c1'],
    });
  });

  it('openAutoMontage uses all selected clip ids when payload item is in selection', () => {
    mockSelectionStore.selectedEntity = {
      source: 'timeline',
      kind: 'clips',
      items: [
        { trackId: 'v1', itemId: 'c1' },
        { trackId: 'v1', itemId: 'c2' },
      ],
    };

    result.openAutoMontage({
      action: 'openAutoMontage',
      trackId: 'v1',
      itemId: 'c1',
    });

    expect(result.autoMontageModal.value).toEqual({
      open: true,
      itemIds: ['c1', 'c2'],
    });
  });

  it('openAutoMontage falls back to single item when payload item is not in selection', () => {
    mockSelectionStore.selectedEntity = {
      source: 'timeline',
      kind: 'clips',
      items: [{ trackId: 'v1', itemId: 'c2' }],
    };

    result.openAutoMontage({
      action: 'openAutoMontage',
      trackId: 'v1',
      itemId: 'c1',
    });

    expect(result.autoMontageModal.value).toEqual({
      open: true,
      itemIds: ['c1'],
    });
  });

  it('applyAutoMontage does nothing when modal is null', async () => {
    result.autoMontageModal.value = null;

    await result.applyAutoMontage({
      trimStart: true,
      trimEnd: true,
      trimMiddle: true,
      mode: 'cut',
    });

    expect(mockApplySilenceTrimming).not.toHaveBeenCalled();
  });

  it('applyAutoMontage calls applySilenceTrimming with modal item ids', async () => {
    result.autoMontageModal.value = { open: true, itemIds: ['c1', 'c2'] };

    await result.applyAutoMontage({
      trimStart: true,
      trimEnd: false,
      trimMiddle: true,
      mode: 'mark',
    });

    expect(mockApplySilenceTrimming).toHaveBeenCalledWith({
      clipIds: ['c1', 'c2'],
      settings: {
        trimStart: true,
        trimEnd: false,
        trimMiddle: true,
        mode: 'mark',
      },
    });
  });

  it('watches openAutoMontageTrigger and opens modal when item belongs to tracks', async () => {
    mockUiStore.openAutoMontageTrigger = { itemIds: ['c1'], timestamp: Date.now() };

    // Wait for Vue watcher to flush
    await nextTick();

    expect(result.autoMontageModal.value).toEqual({
      open: true,
      itemIds: ['c1'],
    });
  });

  it('does not open modal when triggered item is not in rendered tracks', async () => {
    mockUiStore.openAutoMontageTrigger = { itemIds: ['unknown'], timestamp: Date.now() };

    await nextTick();

    expect(result.autoMontageModal.value).toBeNull();
  });
});
