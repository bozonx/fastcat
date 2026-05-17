/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAddMediaToTimeline } from '~/composables/timeline/useAddMediaToTimeline';

const { timelineStoreMock, mediaStoreMock, vfsGetFileMock } = vi.hoisted(() => ({
  timelineStoreMock: {
    currentTime: 0,
    timelineDoc: {
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
    addVirtualClipToTrack: vi.fn(),
    requestTimelineSave: vi.fn(),
  },
  mediaStoreMock: {
    getOrFetchMetadataByPath: vi.fn(),
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
        defaultStaticClipDurationUs: 5_000_000,
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
    timelineStoreMock.addVirtualClipToTrack.mockReset();
    timelineStoreMock.requestTimelineSave.mockReset();
    mediaStoreMock.getOrFetchMetadataByPath.mockReset();
    vfsGetFileMock.mockReset();
  });

  it('places multiple media files sequentially instead of reusing the playhead time', async () => {
    timelineStoreMock.addClipToTimelineFromPath.mockResolvedValueOnce({ durationUs: 2_000_000 });
    timelineStoreMock.addClipToTimelineFromPath.mockResolvedValueOnce({ durationUs: 3_000_000 });
    mediaStoreMock.getOrFetchMetadataByPath.mockResolvedValueOnce({ duration: 2 });
    mediaStoreMock.getOrFetchMetadataByPath.mockResolvedValueOnce({ duration: 3 });

    const { addMediaToTimeline } = useAddMediaToTimeline();

    await addMediaToTimeline([
      { name: 'one.mp4', path: '_video/one.mp4' },
      { name: 'two.mp4', path: '_video/two.mp4' },
    ]);

    expect(timelineStoreMock.addClipToTimelineFromPath).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ path: '_video/one.mp4', startUs: 0 }),
    );
    expect(timelineStoreMock.addClipToTimelineFromPath).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ path: '_video/two.mp4', startUs: 2_000_000 }),
    );
    expect(timelineStoreMock.requestTimelineSave).toHaveBeenCalledWith({ immediate: true });
  });

  it('moves insertion past an existing clip on the target track', async () => {
    timelineStoreMock.currentTime = 500_000;
    timelineStoreMock.timelineDoc.tracks[0] = {
      id: 'v1',
      kind: 'video',
      items: [
        {
          id: 'clip-1',
          kind: 'clip',
          timelineRange: { startUs: 0, durationUs: 2_000_000 },
        },
      ],
    };
    timelineStoreMock.addClipToTimelineFromPath.mockResolvedValueOnce({ durationUs: 1_000_000 });
    mediaStoreMock.getOrFetchMetadataByPath.mockResolvedValueOnce({ duration: 1 });

    const { addMediaToTimeline } = useAddMediaToTimeline();

    await addMediaToTimeline([{ name: 'new.mp4', path: '_video/new.mp4' }]);

    expect(timelineStoreMock.addClipToTimelineFromPath).toHaveBeenCalledWith(
      expect.objectContaining({ startUs: 2_000_000 }),
    );
  });
});
