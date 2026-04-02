/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTimelineCommandService } from '~/timeline/application/timelineCommandService';

describe('TimelineCommandService', () => {
  let deps: any;
  let service: ReturnType<typeof createTimelineCommandService>;

  beforeEach(() => {
    deps = {
      getTimelineDoc: vi.fn(),
      ensureTimelineDoc: vi.fn(),
      getCurrentTimelinePath: vi.fn(() => 'root.otio'),
      getTrackById: vi.fn((id) => ({
        id,
        kind: id.startsWith('v') ? 'video' : 'audio',
        items: [],
      })),
      applyTimeline: vi.fn(() => ['new-item-id']),
      getFileHandleByPath: vi.fn(),
      getFileByPath: vi.fn(),
      getOrFetchMetadataByPath: vi.fn(),
      getMediaMetadataByPath: vi.fn(),
      fetchMediaMetadataByPath: vi.fn(),
      getUserSettings: vi.fn(() => ({
        optimization: { autoCreateProxies: false },
        projectDefaults: { defaultAudioFadeCurve: 's_curve' },
      })),
      getProjectSettings: vi.fn(() => ({
        project: { width: 1920, height: 1080, fps: 30, isAutoSettings: false },
      })),
      updateProjectSettings: vi.fn(),
      showFpsWarning: vi.fn(),
      mediaCache: { hasProxy: vi.fn(() => false), ensureProxy: vi.fn() },
      defaultImageDurationUs: 5_000_000,
      defaultImageSourceDurationUs: 5_000_000,
      parseTimelineFromOtio: vi.fn(),
      selectTimelineDurationUs: vi.fn(() => 10_000_000),
    };

    service = createTimelineCommandService(deps);
  });

  describe('addClipToTimelineFromPath', () => {
    it('adds a video clip and checks FPS', async () => {
      deps.getOrFetchMetadataByPath.mockResolvedValue({
        duration: 10,
        video: { width: 1920, height: 1080, fps: 60 }, // Project is 30, file is 60
      });
      deps.getFileByPath.mockResolvedValue(new File([], 'test.mp4'));

      await service.addClipToTimelineFromPath({
        trackId: 'v1',
        name: 'Test Clip',
        path: 'video/test.mp4',
      });

      expect(deps.applyTimeline).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'add_clip_to_track',
          path: 'video/test.mp4',
          durationUs: 10_000_000,
        }),
        undefined,
      );

      // Should show FPS warning
      expect(deps.showFpsWarning).toHaveBeenCalledWith(60, 30);
    });

    it('updates project settings if isAutoSettings is true', async () => {
      deps.getProjectSettings.mockReturnValue({
        project: { width: 1920, height: 1080, fps: 30, isAutoSettings: true },
      });
      deps.getOrFetchMetadataByPath.mockResolvedValue({
        duration: 10,
        video: { width: 1280, height: 720, fps: 24 },
      });
      deps.getFileByPath.mockResolvedValue(new File([], 'test.mp4'));

      await service.addClipToTimelineFromPath({
        trackId: 'v1',
        name: 'Test Clip',
        path: 'video/test.mp4',
      });

      expect(deps.updateProjectSettings).toHaveBeenCalledWith({
        width: 1280,
        height: 720,
        fps: 24,
        isAutoSettings: false,
      });
    });
  });

  describe('circular dependencies', () => {
    it('throws error when inserting current timeline into itself', async () => {
      await expect(
        service.addTimelineClipFromPath({
          trackId: 'v1',
          name: 'Self',
          path: 'root.otio', // Same as getCurrentTimelinePath
        }),
      ).rejects.toThrow('Cannot insert the currently opened timeline into itself');
    });
  });
});
