import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TimelineTrack, TimelineClipItem } from '~/timeline/types';

const mockTimelineStore = {
  updateClipProperties: vi.fn(),
  requestTimelineSave: vi.fn().mockResolvedValue(undefined),
};

const mockMediaStore = {
  getCachedMetadata: vi.fn(),
};

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/media.store', () => ({
  useMediaStore: () => mockMediaStore,
}));

function makeClip(overrides: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    id: 'c1',
    kind: 'clip',
    clipType: 'media',
    trackId: 'v1',
    name: 'Clip 1',
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
    source: { path: '/video.mp4' },
    ...overrides,
  } as TimelineClipItem;
}

function makeTrack(items: TimelineClipItem[], overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'v1',
    kind: 'video',
    name: 'Video 1',
    items,
    ...overrides,
  } as TimelineTrack;
}

describe('useTimelineSpeedModal', () => {
  let result: {
    speedModal: { value: { open: boolean; trackId: string; itemId: string; speed: number } | null };
    openSpeedModal: (trackId: string, itemId: string, currentSpeed: number | null | undefined) => void;
    saveSpeedModal: () => Promise<void>;
    speedModalTargetHasAudio: { value: boolean };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { useTimelineSpeedModal } = await import('~/composables/timeline/useTimelineSpeedModal');
    result = useTimelineSpeedModal(() => [
      makeTrack([makeClip()], { id: 'v1', kind: 'video' }),
      makeTrack([makeClip({ id: 'a1', trackId: 'a1' })], { id: 'a1', kind: 'audio' }),
    ]);
  });

  it('openSpeedModal sets modal with current speed', () => {
    result.openSpeedModal('v1', 'c1', 2.5);

    expect(result.speedModal.value).toEqual({
      open: true,
      trackId: 'v1',
      itemId: 'c1',
      speed: 2.5,
    });
  });

  it('openSpeedModal defaults speed to 1 when currentSpeed is null', () => {
    result.openSpeedModal('v1', 'c1', null);

    expect(result.speedModal.value!.speed).toBe(1);
  });

  it('openSpeedModal defaults speed to 1 when currentSpeed is undefined', () => {
    result.openSpeedModal('v1', 'c1', undefined);

    expect(result.speedModal.value!.speed).toBe(1);
  });

  it('saveSpeedModal does nothing when modal is null', async () => {
    result.speedModal.value = null;

    await result.saveSpeedModal();

    expect(mockTimelineStore.updateClipProperties).not.toHaveBeenCalled();
  });

  it('saveSpeedModal does nothing when speed is too small (< 0.1)', async () => {
    result.speedModal.value = { open: true, trackId: 'v1', itemId: 'c1', speed: 0.05 };

    await result.saveSpeedModal();

    expect(mockTimelineStore.updateClipProperties).not.toHaveBeenCalled();
  });

  it('saveSpeedModal calls updateClipProperties and closes modal', async () => {
    result.speedModal.value = { open: true, trackId: 'v1', itemId: 'c1', speed: 2 };

    await result.saveSpeedModal();

    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('v1', 'c1', { speed: 2 });
    expect(result.speedModal.value!.open).toBe(false);
    expect(mockTimelineStore.requestTimelineSave).toHaveBeenCalledWith({ immediate: true });
  });

  it('saveSpeedModal handles negative speed (reverse playback)', async () => {
    result.speedModal.value = { open: true, trackId: 'v1', itemId: 'c1', speed: -1 };

    await result.saveSpeedModal();

    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('v1', 'c1', { speed: -1 });
  });

  it('speedModalTargetHasAudio returns false when modal is null', () => {
    result.speedModal.value = null;

    expect(result.speedModalTargetHasAudio.value).toBe(false);
  });

  it('speedModalTargetHasAudio returns true for audio track clip', () => {
    result.speedModal.value = { open: true, trackId: 'a1', itemId: 'a1', speed: 1 };

    expect(result.speedModalTargetHasAudio.value).toBe(true);
  });

  it('speedModalTargetHasAudio returns false for muted video clip', async () => {
    const clip = makeClip({ id: 'c1', audioMuted: true });
    const { useTimelineSpeedModal } = await import('~/composables/timeline/useTimelineSpeedModal');
    const localResult = useTimelineSpeedModal(() => [
      makeTrack([clip], { id: 'v1', kind: 'video' }),
    ]);

    localResult.speedModal.value = { open: true, trackId: 'v1', itemId: 'c1', speed: 1 };

    expect(localResult.speedModalTargetHasAudio.value).toBe(false);
  });

  it('speedModalTargetHasAudio returns true for video clip with audio metadata', () => {
    mockMediaStore.getCachedMetadata.mockReturnValue({ audio: true });

    result.speedModal.value = { open: true, trackId: 'v1', itemId: 'c1', speed: 1 };

    expect(result.speedModalTargetHasAudio.value).toBe(true);
  });

  it('speedModalTargetHasAudio returns false for video clip without audio metadata', () => {
    mockMediaStore.getCachedMetadata.mockReturnValue(null);

    result.speedModal.value = { open: true, trackId: 'v1', itemId: 'c1', speed: 1 };

    expect(result.speedModalTargetHasAudio.value).toBe(false);
  });
});
