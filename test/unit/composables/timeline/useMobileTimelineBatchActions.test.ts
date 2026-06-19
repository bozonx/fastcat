/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { useMobileTimelineBatchActions } from '~/composables/timeline/useMobileTimelineBatchActions';

const mockClipboardStore = {
  setClipboardPayload: vi.fn(),
};

const mockTimelineStore = {
  copySelectedClips: vi.fn(() => [{ sourceTrackId: 't1', clip: { id: 'c1' } }]),
  cutSelectedClips: vi.fn(() => [{ sourceTrackId: 't2', clip: { id: 'c2' } }]),
  splitAllClipsAtPlayhead: vi.fn(),
};

describe('useMobileTimelineBatchActions', () => {
  it('copies selected clips to clipboard', () => {
    const { handleCopyClips } = useMobileTimelineBatchActions({
      clipboardStore: mockClipboardStore as any,
      timelineStore: mockTimelineStore as any,
    });

    handleCopyClips();

    expect(mockTimelineStore.copySelectedClips).toHaveBeenCalled();
    expect(mockClipboardStore.setClipboardPayload).toHaveBeenCalledWith({
      source: 'timeline',
      operation: 'copy',
      items: [{ sourceTrackId: 't1', clip: { id: 'c1' } }],
    });
  });

  it('cuts selected clips to clipboard', () => {
    const { handleCutClips } = useMobileTimelineBatchActions({
      clipboardStore: mockClipboardStore as any,
      timelineStore: mockTimelineStore as any,
    });

    handleCutClips();

    expect(mockTimelineStore.cutSelectedClips).toHaveBeenCalled();
    expect(mockClipboardStore.setClipboardPayload).toHaveBeenCalledWith({
      source: 'timeline',
      operation: 'cut',
      items: [{ sourceTrackId: 't2', clip: { id: 'c2' } }],
    });
  });

  it('splits all clips at playhead', () => {
    const { handleBladeClips } = useMobileTimelineBatchActions({
      clipboardStore: mockClipboardStore as any,
      timelineStore: mockTimelineStore as any,
    });

    handleBladeClips();

    expect(mockTimelineStore.splitAllClipsAtPlayhead).toHaveBeenCalled();
  });
});
