/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineDocument } from '~/timeline/types';
import { MARKER_THUMBNAILS } from '~/utils/constants';

const extractTimelineFrameBlobMock = vi.hoisted(() => vi.fn());
const saveMarkerThumbnailMock = vi.hoisted(() => vi.fn());

vi.mock('~/composables/useMediaProcessor', () => ({
  useMediaProcessor: () => ({ extractTimelineFrameBlob: extractTimelineFrameBlobMock }),
}));
vi.mock('~/utils/file-thumbnail-generator', () => ({
  fileThumbnailGenerator: { saveMarkerThumbnail: saveMarkerThumbnailMock },
}));

// Run the queued task synchronously so we can assert without real timers.
vi.mock('~/utils/media-task-queue', () => ({
  MEDIA_TASK_PRIORITIES: { timelineThumbnailLazy: 0 },
  addLatestMediaTask: (input: { task: () => Promise<void> }) => input.task(),
}));

const timelineDoc = { timebase: { fps: 30 }, tracks: [] } as unknown as TimelineDocument;

function baseParams() {
  return {
    projectId: 'project-1',
    markerId: 'marker-1',
    timeUs: 2_000_000,
    timelineDoc,
  };
}

describe('dispatchMarkerThumbnailGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extractTimelineFrameBlobMock.mockResolvedValue(new Blob(['x'], { type: 'image/webp' }));
    saveMarkerThumbnailMock.mockResolvedValue('blob:marker-url');
  });

  it('renders at marker resolution with the cheapest effect-quality tier (backend-agnostic)', async () => {
    const { dispatchMarkerThumbnailGeneration } =
      await import('~/timeline/services/marker-thumbnail.service');
    const onComplete = vi.fn();

    dispatchMarkerThumbnailGeneration({ ...baseParams(), onComplete });
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith('blob:marker-url'));

    expect(extractTimelineFrameBlobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        timeUs: 2_000_000,
        maxWidth: MARKER_THUMBNAILS.WIDTH,
        maxHeight: MARKER_THUMBNAILS.HEIGHT,
        effectQuality: 'low',
      }),
    );
    // Fixed exact-output width/height are never passed, so each processor fits the
    // scene into the marker box instead of rendering large then downscaling.
    const call = extractTimelineFrameBlobMock.mock.calls[0][0];
    expect(call.width).toBeUndefined();
    expect(call.height).toBeUndefined();
  });

  it('reports an error and does not save when the render yields no frame', async () => {
    extractTimelineFrameBlobMock.mockResolvedValue(null);
    const { dispatchMarkerThumbnailGeneration } =
      await import('~/timeline/services/marker-thumbnail.service');
    const onError = vi.fn();
    const onComplete = vi.fn();

    dispatchMarkerThumbnailGeneration({ ...baseParams(), onComplete, onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());

    expect(saveMarkerThumbnailMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('surfaces extraction failures through onError', async () => {
    extractTimelineFrameBlobMock.mockRejectedValue(new Error('decode failed'));
    const { dispatchMarkerThumbnailGeneration } =
      await import('~/timeline/services/marker-thumbnail.service');
    const onError = vi.fn();

    dispatchMarkerThumbnailGeneration({ ...baseParams(), onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
  });
});
