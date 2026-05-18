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
        { id: 'clip-1', kind: 'clip', timelineRange: { startUs: 0, durationUs: 1_000_000 }, locked: false },
        { id: 'clip-2', kind: 'clip', timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 }, locked: true },
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
    selectedItemIds: ref<string[]>(['clip-1', 'clip-2']),
    applyTimeline: vi.fn(),
    batchApplyTimeline: vi.fn(),
    requestTimelineSave: vi.fn().mockResolvedValue(undefined),
    getHotkeyTargetClip: vi.fn().mockReturnValue({ trackId: 'track-1', itemId: 'clip-1' }),
    getSelectedOrActiveTrackId: vi.fn().mockReturnValue('track-1'),
    editService: {
      rippleDeleteRange: vi.fn(),
      rippleTrimRight: vi.fn().mockResolvedValue(undefined),
      rippleTrimLeft: vi.fn().mockResolvedValue(undefined),
      advancedRippleTrimRight: vi.fn().mockResolvedValue(undefined),
      advancedRippleTrimLeft: vi.fn().mockResolvedValue(undefined),
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
  });

  it('jumpToNextClipBoundary sets currentTime to boundary', () => {
    const deps = createMockDeps();
    const mod = createTimelineTrimmingModule(deps);
    mod.jumpToNextClipBoundary();
    expect(deps.currentTime.value).toBe(2_000_000);
  });

  it('rippleDeleteRange delegates to editService', () => {
    const deps = createMockDeps();
    const mod = createTimelineTrimmingModule(deps);
    const input = { trackIds: ['track-1'], startUs: 0, endUs: 500_000 };
    mod.rippleDeleteRange(input, { someOption: true });
    expect(deps.editService.rippleDeleteRange).toHaveBeenCalledWith(input, { someOption: true });
  });

  it('rippleTrimRight delegates to editService', async () => {
    const deps = createMockDeps();
    const mod = createTimelineTrimmingModule(deps);
    await mod.rippleTrimRight();
    expect(deps.editService.rippleTrimRight).toHaveBeenCalled();
  });

  it('splitClipAtPlayhead applies split commands', async () => {
    const deps = createMockDeps();
    const mod = createTimelineTrimmingModule(deps);
    await mod.splitClipAtPlayhead();
    expect(deps.applyTimeline).toHaveBeenCalled();
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
