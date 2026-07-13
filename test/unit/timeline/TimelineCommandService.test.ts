/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { timelineUs } from '../utils/timeline-time';
import { createTimelineCommandService } from '~/timeline/application/timelineCommandService';

describe('TimelineCommandService', () => {
  let deps: any;
  let service: ReturnType<typeof createTimelineCommandService>;

  beforeEach(() => {
    deps = {
      getTimelineDoc: vi.fn(() => ({
        timebase: { fps: 30 },
        tracks: [{ id: 'v1', kind: 'video', items: [] }],
        metadata: {
          fastcat: {
            format: {
              width: 1920,
              height: 1080,
              fps: 30,
              sampleRate: 48000,
              isAutoSettings: false,
              settingsSource: 'manual',
            },
          },
        },
      })),
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
        project: {
          width: 1920,
          height: 1080,
          fps: 30,
          sampleRate: 48000,
          isAutoSettings: false,
          geometryResolved: true,
          sampleRateResolved: true,
        },
      })),
      updateTimelineFormat: vi.fn(),
      updateProjectFormat: vi.fn(),
      showAutoSettingsApplied: vi.fn(),
      mediaCache: { hasProxy: vi.fn(() => false), ensureProxy: vi.fn() },
      defaultImageDurationUs: timelineUs(5_000_000),
      defaultImageSourceDurationUs: timelineUs(5_000_000),
      parseTimelineFromOtio: vi.fn(),
      selectTimelineDurationUs: vi.fn(() => timelineUs(10_000_000)),
    };

    service = createTimelineCommandService(deps);
  });

  describe('addClipToTimelineFromPath', () => {
    it('warns on an uneven FPS cadence', async () => {
      deps.getOrFetchMetadataByPath.mockResolvedValue({
        duration: 10,
        // Project is 30, file is 50 — ratio 1.667 samples unevenly and judders.
        video: { width: 1920, height: 1080, fps: 50, canDecode: true },
      });
      deps.getFileByPath.mockResolvedValue(new File([], 'test.mp4'));

      const result = await service.addClipToTimelineFromPath({
        trackId: 'v1',
        name: 'Test Clip',
        path: 'video/test.mp4',
      });

      expect(deps.applyTimeline).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'add_clip_to_track',
          path: 'video/test.mp4',
          durationUs: timelineUs(10_000_000),
        }),
        undefined,
      );

      // Should return FPS mismatch warning
      expect(result.warnings).toEqual([{ type: 'fpsMismatch', fileFps: 50, projectFps: 30 }]);
    });

    it('does not warn when the FPS ratio is an integer multiple', async () => {
      deps.getOrFetchMetadataByPath.mockResolvedValue({
        duration: 10,
        // Project is 30, file is 60 — even 2:1 cadence, no judder, no warning.
        video: { width: 1920, height: 1080, fps: 60, canDecode: true },
      });
      deps.getFileByPath.mockResolvedValue(new File([], 'test.mp4'));

      const result = await service.addClipToTimelineFromPath({
        trackId: 'v1',
        name: 'Test Clip',
        path: 'video/test.mp4',
      });

      expect(result.warnings).toBeUndefined();
    });

    it('does not warn for tiny FPS metadata drift', async () => {
      deps.getTimelineDoc.mockReturnValue({
        timebase: { fps: 29.97 },
        tracks: [{ id: 'v1', kind: 'video', items: [{ kind: 'clip' }] }],
        metadata: {
          fastcat: {
            format: {
              width: 1920,
              height: 1080,
              fps: 29.97,
              sampleRate: 48000,
              isAutoSettings: false,
              settingsSource: 'manual',
              useProjectSettings: false,
            },
          },
        },
      });
      deps.getOrFetchMetadataByPath.mockResolvedValue({
        duration: 10,
        video: { width: 1920, height: 1080, fps: 29.97003, canDecode: true },
      });
      deps.getFileByPath.mockResolvedValue(new File([], 'test.mp4'));

      const result = await service.addClipToTimelineFromPath({
        trackId: 'v1',
        name: 'Test Clip',
        path: 'video/test.mp4',
      });

      expect(result.warnings).toBeUndefined();
    });

    it('rejects media when the target track codec cannot be decoded', async () => {
      deps.getOrFetchMetadataByPath.mockResolvedValue({
        duration: 10,
        video: { width: 1920, height: 1080, fps: 30, canDecode: false },
      });
      deps.getFileByPath.mockResolvedValue(new File([], 'test.mp4'));

      await expect(
        service.addClipToTimelineFromPath({
          trackId: 'v1',
          name: 'Unsupported',
          path: 'video/unsupported.mp4',
        }),
      ).rejects.toThrow('Video codec is not supported');

      expect(deps.applyTimeline).not.toHaveBeenCalled();
    });

    it('rejects audio when the target track codec cannot be decoded', async () => {
      deps.getOrFetchMetadataByPath.mockResolvedValue({
        duration: 10,
        audio: { sampleRate: 48_000, canDecode: false },
      });
      deps.getFileByPath.mockResolvedValue(new File([], 'test.wav'));

      await expect(
        service.addClipToTimelineFromPath({
          trackId: 'a1',
          name: 'Unsupported',
          path: 'audio/unsupported.wav',
        }),
      ).rejects.toThrow('Audio codec is not supported');

      expect(deps.applyTimeline).not.toHaveBeenCalled();
    });

    it('adopts the first video geometry into the timeline while it is in auto mode', async () => {
      deps.getTimelineDoc.mockReturnValue({
        timebase: { fps: 30 },
        tracks: [{ id: 'v1', kind: 'video', items: [] }],
        metadata: {
          fastcat: {
            format: {
              width: 1920,
              height: 1080,
              fps: 30,
              sampleRate: 48000,
              isAutoSettings: true,
              geometryResolved: false,
              sampleRateResolved: false,
              settingsSource: 'projectDefaults',
              useProjectSettings: false,
            },
          },
        },
      });
      deps.getOrFetchMetadataByPath.mockResolvedValue({
        duration: 10,
        video: { width: 1280, height: 720, fps: 24, canDecode: true },
      });
      deps.getFileByPath.mockResolvedValue(new File([], 'test.mp4'));

      await service.addClipToTimelineFromPath({
        trackId: 'v1',
        name: 'Test Clip',
        path: 'video/test.mp4',
      });

      expect(deps.updateTimelineFormat).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 1280,
          height: 720,
          fps: 24,
          geometryResolved: true,
          sampleRateResolved: false,
          settingsSource: 'firstClip',
          useProjectSettings: false,
        }),
      );
      expect(deps.updateProjectFormat).not.toHaveBeenCalled();
    });

    it('uses effective portrait dimensions for the first rotated video', async () => {
      deps.getTimelineDoc.mockReturnValue({
        timebase: { fps: 30 },
        tracks: [{ id: 'v1', kind: 'video', items: [] }],
        metadata: {
          fastcat: {
            format: {
              width: 1920,
              height: 1080,
              fps: 30,
              sampleRate: 48000,
              isAutoSettings: true,
              geometryResolved: false,
              sampleRateResolved: false,
              settingsSource: 'projectDefaults',
              useProjectSettings: false,
            },
          },
        },
      });
      deps.getOrFetchMetadataByPath.mockResolvedValue({
        duration: 10,
        video: { width: 1920, height: 1080, rotation: 90, fps: 30, canDecode: true },
      });
      deps.getFileByPath.mockResolvedValue(new File([], 'vertical.mp4'));

      await service.addClipToTimelineFromPath({
        trackId: 'v1',
        name: 'Vertical Clip',
        path: 'video/vertical.mp4',
      });

      expect(deps.updateTimelineFormat).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 1080,
          height: 1920,
          fps: 30,
          orientation: 'portrait',
          geometryResolved: true,
        }),
      );
    });

    it('adopts the first clip format into the timeline when it is unconfigured', async () => {
      deps.getTimelineDoc.mockReturnValue({
        timebase: { fps: 30 },
        tracks: [{ id: 'v1', kind: 'video', items: [] }],
        metadata: {
          fastcat: {
            format: {
              width: 1920,
              height: 1080,
              fps: 30,
              sampleRate: 48000,
              isAutoSettings: true,
              geometryResolved: false,
              sampleRateResolved: false,
              settingsSource: 'projectDefaults',
              useProjectSettings: false,
            },
          },
        },
      });
      deps.getOrFetchMetadataByPath.mockResolvedValue({
        duration: 10,
        video: { width: 1280, height: 720, fps: 24, canDecode: true },
        audio: { sampleRate: 44100 },
      });
      deps.getFileByPath.mockResolvedValue(new File([], 'test.mp4'));

      await service.addClipToTimelineFromPath({
        trackId: 'v1',
        name: 'Test Clip',
        path: 'video/test.mp4',
      });

      expect(deps.updateTimelineFormat).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 1280,
          height: 720,
          fps: 24,
          sampleRate: 44100,
          geometryResolved: true,
          sampleRateResolved: true,
          settingsSource: 'firstClip',
          useProjectSettings: false,
        }),
      );
      expect(deps.updateProjectFormat).not.toHaveBeenCalled();
    });

    it('resolves only the sample rate from an audio-only first clip, leaving geometry pending', async () => {
      deps.getTimelineDoc.mockReturnValue({
        timebase: { fps: 30 },
        tracks: [{ id: 'a1', kind: 'audio', items: [] }],
        metadata: {
          fastcat: {
            format: {
              width: 1920,
              height: 1080,
              fps: 30,
              sampleRate: 48000,
              isAutoSettings: true,
              geometryResolved: false,
              sampleRateResolved: false,
              settingsSource: 'projectDefaults',
              useProjectSettings: false,
            },
          },
        },
      });
      deps.getProjectSettings.mockReturnValue({
        project: {
          width: 1920,
          height: 1080,
          fps: 30,
          sampleRate: 48000,
          isAutoSettings: true,
          geometryResolved: false,
          sampleRateResolved: false,
        },
      });
      // Audio-only clip: no video stream, only a sample rate.
      deps.getOrFetchMetadataByPath.mockResolvedValue({
        duration: 10,
        audio: { sampleRate: 44100 },
      });
      deps.getFileByPath.mockResolvedValue(new File([], 'music.mp3'));

      await service.addClipToTimelineFromPath({
        trackId: 'a1',
        name: 'Music',
        path: 'audio/music.mp3',
      });

      expect(deps.updateTimelineFormat).toHaveBeenCalledWith(
        expect.objectContaining({
          sampleRate: 44100,
          geometryResolved: false,
          sampleRateResolved: true,
          settingsSource: 'firstClip',
          useProjectSettings: false,
        }),
      );
      expect(deps.updateProjectFormat).not.toHaveBeenCalled();
    });

    it('sequentially resolves audio sampleRate first and video geometry second when dropped in order', async () => {
      const timelineFormat = {
        width: 1920,
        height: 1080,
        fps: 30,
        sampleRate: 48000,
        isAutoSettings: true,
        geometryResolved: false,
        sampleRateResolved: false,
        settingsSource: 'projectDefaults',
        useProjectSettings: false,
      };

      deps.getTimelineDoc.mockImplementation(() => ({
        timebase: { fps: timelineFormat.fps },
        tracks: [
          { id: 'v1', kind: 'video', items: [] },
          { id: 'a1', kind: 'audio', items: [] },
        ],
        metadata: { fastcat: { format: timelineFormat } },
      }));

      deps.updateTimelineFormat.mockImplementation((patch: Partial<typeof timelineFormat>) => {
        Object.assign(timelineFormat, patch);
      });

      // 1. Drop Audio-only file first
      deps.getOrFetchMetadataByPath.mockResolvedValueOnce({
        duration: 10,
        audio: { sampleRate: 44100 },
      });
      deps.getFileByPath.mockResolvedValueOnce(new File([], 'music.mp3'));

      await service.addClipToTimelineFromPath({
        trackId: 'a1',
        name: 'Music',
        path: 'audio/music.mp3',
      });

      expect(deps.updateTimelineFormat).toHaveBeenLastCalledWith(
        expect.objectContaining({ sampleRate: 44100, sampleRateResolved: true }),
      );
      expect(timelineFormat.sampleRateResolved).toBe(true);
      expect(timelineFormat.geometryResolved).toBe(false);

      // 2. Drop Video-only file second
      deps.getOrFetchMetadataByPath.mockResolvedValueOnce({
        duration: 5,
        video: { width: 1280, height: 720, fps: 60, canDecode: true },
      });
      deps.getFileByPath.mockResolvedValueOnce(new File([], 'clip.mp4'));

      await service.addClipToTimelineFromPath({
        trackId: 'v1',
        name: 'Clip',
        path: 'video/clip.mp4',
      });

      expect(deps.updateTimelineFormat).toHaveBeenLastCalledWith(
        expect.objectContaining({
          width: 1280,
          height: 720,
          fps: 60,
          geometryResolved: true,
        }),
      );
      expect(timelineFormat.geometryResolved).toBe(true);
      expect(timelineFormat.sampleRateResolved).toBe(true);
      expect(timelineFormat.sampleRate).toBe(44_100);

      // 3. Drop another Video file third - should NOT update project settings again
      deps.updateTimelineFormat.mockClear();
      deps.getOrFetchMetadataByPath.mockResolvedValueOnce({
        duration: 8,
        video: { width: 1920, height: 1080, fps: 24, canDecode: true },
      });
      deps.getFileByPath.mockResolvedValueOnce(new File([], 'clip2.mp4'));

      await service.addClipToTimelineFromPath({
        trackId: 'v1',
        name: 'Clip 2',
        path: 'video/clip2.mp4',
      });

      expect(deps.updateTimelineFormat).not.toHaveBeenCalled();
      expect(deps.updateProjectFormat).not.toHaveBeenCalled();
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

    it('detects transitive cycles through normalized relative nested paths', async () => {
      deps.getCurrentTimelinePath.mockReturnValue('timelines/root.otio');
      deps.getFileByPath.mockImplementation(async (path: string) => {
        if (path !== 'timelines/a.otio') return null;
        return { text: async () => 'timeline-a' };
      });
      deps.parseTimelineFromOtio.mockReturnValue({
        timebase: { fps: 30 },
        tracks: [
          {
            id: 'v1',
            kind: 'video',
            items: [
              {
                kind: 'clip',
                clipType: 'timeline',
                id: 'nested-root',
                trackId: 'v1',
                name: 'Root',
                source: { path: './root.otio' },
                timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
                sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
              },
            ],
          },
        ],
      });

      await expect(
        service.addTimelineClipFromPath({
          trackId: 'v1',
          name: 'A',
          path: 'timelines/./a.otio',
        }),
      ).rejects.toThrow('Cannot create circular nested timeline dependency');

      expect(deps.getFileByPath).toHaveBeenCalledWith('timelines/a.otio');
      expect(deps.applyTimeline).not.toHaveBeenCalled();
    });
  });
});
