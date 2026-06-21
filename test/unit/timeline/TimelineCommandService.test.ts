/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
      defaultImageDurationUs: 5_000_000,
      defaultImageSourceDurationUs: 5_000_000,
      parseTimelineFromOtio: vi.fn(),
      selectTimelineDurationUs: vi.fn(() => 10_000_000),
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
          durationUs: 10_000_000,
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

    it('adopts the first video geometry into the project while it is in auto mode', async () => {
      // Project in auto mode with geometry not yet resolved; timeline follows it.
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

      // No audio stream → only geometry is written to the project. The timeline
      // keeps following the project (no updateTimelineFormat call).
      expect(deps.updateProjectFormat).toHaveBeenCalledWith({
        width: 1280,
        height: 720,
        fps: 24,
      });
      expect(deps.updateTimelineFormat).not.toHaveBeenCalled();
    });

    it('uses effective portrait dimensions for the first rotated video', async () => {
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

      expect(deps.updateProjectFormat).toHaveBeenCalledWith({
        width: 1080,
        height: 1920,
        fps: 30,
      });
    });

    it('adopts the first clip format into the project when the project is unconfigured', async () => {
      // Project still in its default "auto" state — first clip should configure it.
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

      // Project takes the clip's geometry and sample rate; the timeline keeps
      // following the project (no per-timeline override).
      expect(deps.updateProjectFormat).toHaveBeenCalledWith({
        width: 1280,
        height: 720,
        fps: 24,
        sampleRate: 44100,
      });
      expect(deps.updateTimelineFormat).not.toHaveBeenCalled();
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
              settingsSource: 'projectDefaults',
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

      // Only the sample rate is written; geometry stays unresolved for a later
      // video clip, and the timeline keeps following the project.
      expect(deps.updateProjectFormat).toHaveBeenCalledWith({ sampleRate: 44100 });
      expect(deps.updateTimelineFormat).not.toHaveBeenCalled();
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
                timelineRange: { startUs: 0, durationUs: 1_000_000 },
                sourceRange: { startUs: 0, durationUs: 1_000_000 },
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
