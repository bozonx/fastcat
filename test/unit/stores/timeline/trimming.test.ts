/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { createTimelineTrimmingModule } from '~/stores/timeline/trimming';

vi.mock('~/timeline/domain/navigation', () => ({
  calculatePrevClipBoundary: vi.fn(() => 500_000),
  calculateNextClipBoundary: vi.fn(() => 2_000_000),
}));

vi.mock('~/timeline/domain/editing', () => ({
  buildSplitClipCommands: vi.fn(() => [{ type: 'split_clip' }]),
  buildSplitAllClipsCommands: vi.fn(() => [{ type: 'split_all' }]),
  buildSplitSelectedClipsCommands: vi.fn(() => [{ type: 'split_selected' }]),
  computeCutUs: vi.fn((doc, time) => time),
}));

const mockDoc = {
  id: 'doc-1',
  tracks: [
    {
      id: 'track-1',
      items: [
        {
          id: 'clip-1',
          kind: 'clip',
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          locked: false,
        },
        {
          id: 'clip-2',
          kind: 'clip',
          timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 },
          locked: true,
        },
      ],
      locked: false,
    },
  ],
};

function createMockDeps() {
  return {
    timelineDoc: ref<any>(mockDoc),
    currentTime: ref(1_000_000),
    duration: ref(5_000_000),
    timelineZoom: ref(50),
    selectedItemIds: ref<string[]>(['clip-1', 'clip-2']),
    applyTimeline: vi.fn(),
    batchApplyTimeline: vi.fn(),
    requestTimelineSave: vi.fn().mockResolvedValue(undefined),
    getHotkeyTargetClip: vi.fn().mockReturnValue({ trackId: 'track-1', itemId: 'clip-1' }),
    getSelectedOrActiveTrackId: vi.fn().mockReturnValue('track-1'),
    onPlayheadJump: vi.fn(),
    editService: {
      rippleDeleteRange: vi.fn().mockReturnValue(null),
      rippleTrimRight: vi.fn().mockResolvedValue(null),
      rippleTrimLeft: vi.fn().mockResolvedValue(null),
      advancedRippleTrimRight: vi.fn().mockResolvedValue(null),
      advancedRippleTrimLeft: vi.fn().mockResolvedValue(null),
    },
  };
}

describe('TimelineTrimmingModule', () => {
  beforeEach(() => vi.clearAllMocks());

  it('jumpToPrevClipBoundary sets currentTime to boundary', () => {
    const deps = createMockDeps();
    const mod = createTimelineTrimmingModule(deps);
    mod.jumpToPrevClipBoundary();
    expect(deps.currentTime.value).toBe(500_000);
    expect(deps.onPlayheadJump).toHaveBeenCalledOnce();
  });

  it('jumpToNextClipBoundary sets currentTime to boundary', () => {
    const deps = createMockDeps();
    const mod = createTimelineTrimmingModule(deps);
    mod.jumpToNextClipBoundary();
    expect(deps.currentTime.value).toBe(2_000_000);
    expect(deps.onPlayheadJump).toHaveBeenCalledOnce();
  });

  it('rippleDeleteRange delegates to editService', () => {
    const deps = createMockDeps();
    const mod = createTimelineTrimmingModule(deps);
    const input = { trackIds: ['track-1'], startUs: 0, endUs: 500_000 };
    mod.rippleDeleteRange(input, { someOption: true });
    expect(deps.editService.rippleDeleteRange).toHaveBeenCalledWith(input, { someOption: true });
  });

  it('rippleDeleteRange moves playhead to pixel-aligned collapse point', () => {
    const deps = createMockDeps();
    deps.editService.rippleDeleteRange.mockReturnValue(123_456);
    const mod = createTimelineTrimmingModule(deps);
    mod.rippleDeleteRange({ trackIds: ['track-1'], startUs: 0, endUs: 500_000 });
    expect(deps.currentTime.value).toBe(123_456);
    expect(deps.onPlayheadJump).toHaveBeenCalledOnce();
  });

  it('rippleTrimRight delegates to editService', async () => {
    const deps = createMockDeps();
    const mod = createTimelineTrimmingModule(deps);
    await mod.rippleTrimRight();
    expect(deps.editService.rippleTrimRight).toHaveBeenCalled();
  });

  it('rippleTrimRight moves playhead to pixel-aligned collapse point', async () => {
    const deps = createMockDeps();
    deps.editService.rippleTrimRight.mockResolvedValue(123_456);
    const mod = createTimelineTrimmingModule(deps);
    await mod.rippleTrimRight();
    expect(deps.currentTime.value).toBe(123_456);
    expect(deps.onPlayheadJump).toHaveBeenCalledOnce();
  });

  it('advancedRippleTrimRight moves playhead to pixel-aligned collapse point', async () => {
    const deps = createMockDeps();
    deps.editService.advancedRippleTrimRight.mockResolvedValue(123_456);
    const mod = createTimelineTrimmingModule(deps);
    await mod.advancedRippleTrimRight();
    expect(deps.currentTime.value).toBe(123_456);
    expect(deps.onPlayheadJump).toHaveBeenCalledOnce();
  });

  it('advancedRippleTrimLeft moves playhead to pixel-aligned collapse point', async () => {
    const deps = createMockDeps();
    deps.editService.advancedRippleTrimLeft.mockResolvedValue(123_456);
    const mod = createTimelineTrimmingModule(deps);
    await mod.advancedRippleTrimLeft();
    expect(deps.currentTime.value).toBe(123_456);
    expect(deps.onPlayheadJump).toHaveBeenCalledOnce();
  });

  it('rippleDeleteSelectedClipRangeAllTracks deletes selected clip bounds across all tracks', () => {
    const deps = createMockDeps();
    deps.timelineDoc.value = {
      ...mockDoc,
      tracks: [
        ...mockDoc.tracks,
        {
          id: 'track-2',
          items: [],
          locked: false,
        },
      ],
    };
    deps.editService.rippleDeleteRange.mockReturnValue(123_456);
    const mod = createTimelineTrimmingModule(deps);

    mod.rippleDeleteSelectedClipRangeAllTracks();

    expect(deps.editService.rippleDeleteRange).toHaveBeenCalledWith(
      {
        trackIds: ['track-1', 'track-2'],
        startUs: 0,
        endUs: 1_000_000,
      },
      expect.objectContaining({
        labelKey: 'videoEditor.fileManager.history.entries.deleteItems',
      }),
    );
    expect(deps.currentTime.value).toBe(123_456);
    expect(deps.onPlayheadJump).toHaveBeenCalledOnce();
  });

  it('rippleDeleteSelectedClipRangeAllTracks requires a selected target clip', () => {
    const deps = createMockDeps();
    deps.selectedItemIds.value = [];
    const mod = createTimelineTrimmingModule(deps);

    mod.rippleDeleteSelectedClipRangeAllTracks();

    expect(deps.editService.rippleDeleteRange).not.toHaveBeenCalled();
  });

  it('rippleDeleteSelectedClipRangeAllTracks works with a selected gap', () => {
    const deps = createMockDeps();
    deps.timelineDoc.value = {
      ...mockDoc,
      tracks: [
        {
          id: 'track-1',
          items: [
            {
              id: 'gap-1',
              kind: 'gap',
              timelineRange: { startUs: 2_000_000, durationUs: 500_000 },
            },
          ],
          locked: false,
        },
        {
          id: 'track-2',
          items: [],
          locked: false,
        },
      ],
    };
    deps.selectedItemIds.value = ['gap-1'];
    const mod = createTimelineTrimmingModule(deps);

    mod.rippleDeleteSelectedClipRangeAllTracks();

    expect(deps.editService.rippleDeleteRange).toHaveBeenCalledWith(
      {
        trackIds: ['track-1', 'track-2'],
        startUs: 2_000_000,
        endUs: 2_500_000,
      },
      expect.any(Object),
    );
  });

  it('splitClipAtPlayhead batches split commands', async () => {
    const deps = createMockDeps();
    const mod = createTimelineTrimmingModule(deps);
    await mod.splitClipAtPlayhead();
    expect(deps.batchApplyTimeline).toHaveBeenCalled();
    expect(deps.requestTimelineSave).toHaveBeenCalledWith({ immediate: true });
  });

  it('splitAllClipsAtPlayhead batches commands when doc exists', async () => {
    const deps = createMockDeps();
    const mod = createTimelineTrimmingModule(deps);
    await mod.splitAllClipsAtPlayhead();
    expect(deps.batchApplyTimeline).toHaveBeenCalledWith(
      [{ type: 'split_all' }],
      expect.objectContaining({ saveMode: 'immediate' }),
    );
  });

  it('splitClipsAtPlayhead filters locked items and batches commands', async () => {
    const deps = createMockDeps();
    const mod = createTimelineTrimmingModule(deps);
    await mod.splitClipsAtPlayhead();
    expect(deps.batchApplyTimeline).toHaveBeenCalledWith(
      [{ type: 'split_selected' }],
      expect.objectContaining({ saveMode: 'immediate' }),
    );
    expect(deps.requestTimelineSave).toHaveBeenCalledWith({ immediate: true });
  });
});
