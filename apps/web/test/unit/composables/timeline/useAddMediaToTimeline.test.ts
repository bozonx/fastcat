/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAddMediaToTimeline } from '~/composables/timeline/useAddMediaToTimeline';

const { timelineStoreMock, mediaStoreMock, vfsGetFileMock } = vi.hoisted(() => ({
  timelineStoreMock: {
    currentTime: 0,
    timelineDoc: {
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          items: [],
        },
        {
          id: 'a1',
          kind: 'audio',
          items: [],
        },
      ],
    },
    addClipToTimelineFromPath: vi.fn(),
    addTimelineClipToTimelineFromPath: vi.fn(),
    addVirtualClipToTrack: vi.fn(),
    getMobileSelectionKind: vi.fn(() => null),
    requestTimelineSave: vi.fn(),
  },
  mediaStoreMock: {
    getOrFetchMetadataByPath: vi.fn(),
    getCachedMetadata: vi.fn(),
  },
  vfsGetFileMock: vi.fn(),
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => timelineStoreMock,
}));

vi.mock('~/stores/media.store', () => ({
  useMediaStore: () => mediaStoreMock,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    userSettings: {
      timeline: {
        defaultStaticClipDurationTicks: 5_000_000,
      },
    },
  }),
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({
    vfs: {
      getFile: vfsGetFileMock,
    },
  }),
}));

describe('useAddMediaToTimeline', () => {
  beforeEach(() => {
    timelineStoreMock.currentTime = 0;
    timelineStoreMock.timelineDoc = {
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          items: [],
        },
        {
          id: 'a1',
          kind: 'audio',
          items: [],
        },
      ],
    };
    timelineStoreMock.addClipToTimelineFromPath.mockReset();
    timelineStoreMock.addTimelineClipToTimelineFromPath.mockReset();
    timelineStoreMock.addVirtualClipToTrack.mockReset();
    timelineStoreMock.getMobileSelectionKind.mockReset();
    timelineStoreMock.getMobileSelectionKind.mockReturnValue(null);
    timelineStoreMock.requestTimelineSave.mockReset();
    mediaStoreMock.getOrFetchMetadataByPath.mockReset();
    vfsGetFileMock.mockReset();
    timelineStoreMock.resolveMobileTargetTrackId = vi.fn((kind) =>
      kind === 'video' ? 'v1' : 'a1',
    );
  });

  it('places multiple media files sequentially instead of reusing the playhead time', async () => {
    timelineStoreMock.addClipToTimelineFromPath.mockResolvedValueOnce({ durationTicks: 2_000_000 });
    timelineStoreMock.addClipToTimelineFromPath.mockResolvedValueOnce({ durationTicks: 3_000_000 });
    mediaStoreMock.getOrFetchMetadataByPath.mockResolvedValueOnce({ duration: 2 });
    mediaStoreMock.getOrFetchMetadataByPath.mockResolvedValueOnce({ duration: 3 });

    const { addMediaToTimeline } = useAddMediaToTimeline();

    await addMediaToTimeline([
      { name: 'one.mp4', path: '_video/one.mp4' },
      { name: 'two.mp4', path: '_video/two.mp4' },
    ]);

    expect(timelineStoreMock.addClipToTimelineFromPath).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ path: '_video/one.mp4', startTicks: 0 }),
    );
    expect(timelineStoreMock.addClipToTimelineFromPath).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ path: '_video/two.mp4', startTicks: 2_000_000 }),
    );
    expect(timelineStoreMock.resolveMobileTargetTrackId).toHaveBeenNthCalledWith(1, 'video', {
      durationTicks: 508_032_000_000,
      startTicks: 0,
    });
    expect(timelineStoreMock.resolveMobileTargetTrackId).toHaveBeenNthCalledWith(2, 'video', {
      durationTicks: 762_048_000_000,
      startTicks: 2_000_000,
    });
    expect(timelineStoreMock.requestTimelineSave).toHaveBeenCalledWith({ immediate: true });
  });

  it('does not shift insertion past an existing clip but inserts at current playhead', async () => {
    timelineStoreMock.currentTime = 500_000;
    timelineStoreMock.timelineDoc.tracks[0] = {
      id: 'v1',
      kind: 'video',
      items: [
        {
          id: 'clip-1',
          kind: 'clip',
          timelineRange: { startTicks: 0, durationTicks: 2_000_000 },
        },
      ],
    };
    timelineStoreMock.addClipToTimelineFromPath.mockResolvedValueOnce({ durationTicks: 1_000_000 });
    mediaStoreMock.getOrFetchMetadataByPath.mockResolvedValueOnce({ duration: 1 });

    const { addMediaToTimeline } = useAddMediaToTimeline();

    await addMediaToTimeline([{ name: 'new.mp4', path: '_video/new.mp4' }]);

    expect(timelineStoreMock.addClipToTimelineFromPath).toHaveBeenCalledWith(
      expect.objectContaining({ startTicks: 500_000 }),
    );
  });

  it('uses an explicit target track without resolving a mobile fallback track', async () => {
    timelineStoreMock.addClipToTimelineFromPath.mockResolvedValueOnce({ durationTicks: 1_000_000 });
    mediaStoreMock.getOrFetchMetadataByPath.mockResolvedValueOnce({ duration: 1 });

    const { addMediaToTimeline } = useAddMediaToTimeline();

    await addMediaToTimeline([{ name: 'voice.wav', path: '_audio/voice.wav' }], {
      targetTrackId: 'a1',
    });

    expect(timelineStoreMock.resolveMobileTargetTrackId).not.toHaveBeenCalled();
    expect(timelineStoreMock.addClipToTimelineFromPath).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: 'a1',
        path: '_audio/voice.wav',
      }),
    );
  });

  it('skips text files instead of creating text clips on mobile', async () => {
    const { addMediaToTimeline } = useAddMediaToTimeline();

    const added = await addMediaToTimeline([{ name: 'notes.txt', path: 'notes.txt' }]);

    expect(added).toBe(false);
    expect(vfsGetFileMock).not.toHaveBeenCalled();
    expect(timelineStoreMock.addVirtualClipToTrack).not.toHaveBeenCalled();
    expect(timelineStoreMock.addClipToTimelineFromPath).not.toHaveBeenCalled();
    expect(timelineStoreMock.requestTimelineSave).not.toHaveBeenCalled();
  });

  it('adds nested timelines with the static mobile duration', async () => {
    timelineStoreMock.addTimelineClipToTimelineFromPath.mockResolvedValueOnce({
      durationTicks: 5_000_000,
    });

    const { addMediaToTimeline } = useAddMediaToTimeline();

    const added = await addMediaToTimeline([{ name: 'nested.otio', path: 'nested.otio' }]);

    expect(added).toBe(true);
    expect(timelineStoreMock.addTimelineClipToTimelineFromPath).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: 'v1',
        name: 'nested.otio',
        path: 'nested.otio',
        startTicks: 0,
      }),
    );
    expect(timelineStoreMock.addClipToTimelineFromPath).not.toHaveBeenCalled();
    expect(timelineStoreMock.requestTimelineSave).toHaveBeenCalledWith({ immediate: true });
  });
});
