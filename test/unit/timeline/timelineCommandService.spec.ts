/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { createTimelineCommandService } from '~/timeline/application/timelineCommandService';

describe('createTimelineCommandService', () => {
  function makeDeps(overrides?: Record<string, unknown>) {
    return {
      getTimelineDoc: vi.fn(() => ({
        timebase: { fps: 30 },
        tracks: [{ id: 'v1', kind: 'video', name: 'V1', items: [] }],
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
      ensureTimelineDoc: vi.fn(() => ({
        id: 'doc1',
        name: 'Test',
        timebase: { fps: 30 },
        tracks: [{ id: 'v1', kind: 'video', name: 'V1', items: [] }],
      })),
      getCurrentTimelinePath: vi.fn(() => '/timelines/main.otio'),
      getTrackById: vi.fn((id: string) => ({
        id,
        kind: 'video',
        name: 'V1',
        items: [],
      })),
      applyTimeline: vi.fn(() => ['new-item-id']),
      getFileHandleByPath: vi.fn().mockResolvedValue(null),
      getFileByPath: vi.fn().mockResolvedValue({}),
      getOrFetchMetadataByPath: vi.fn().mockResolvedValue({
        duration: 10,
        video: { width: 1920, height: 1080, fps: 30 },
      }),
      getMediaMetadataByPath: vi.fn(() => null),
      fetchMediaMetadataByPath: vi.fn().mockResolvedValue(null),
      getUserSettings: vi.fn(() => ({
        optimization: { autoCreateProxies: false },
        projectDefaults: { defaultAudioFadeCurve: 'linear' as const },
      })),
      getProjectSettings: vi.fn(() => ({
        project: { width: 1920, height: 1080, fps: 30, isAutoSettings: false },
      })),
      updateTimelineFormat: vi.fn().mockResolvedValue(undefined),
      showAutoSettingsApplied: vi.fn(),
      showFpsWarning: vi.fn(),
      mediaCache: {
        hasProxy: vi.fn(() => false),
        ensureProxy: vi.fn().mockResolvedValue(undefined),
      },
      defaultImageDurationUs: 5_000_000,
      defaultImageSourceDurationUs: 5_000_000,
      parseTimelineFromOtio: vi.fn(),
      selectTimelineDurationUs: vi.fn(),
      ...overrides,
    };
  }

  it('bails when metadata has error flag', async () => {
    const deps = makeDeps({
      getOrFetchMetadataByPath: vi.fn().mockResolvedValue({
        duration: 0,
        error: true,
      }),
    });
    const service = createTimelineCommandService(deps);
    await expect(
      service.addClipToTimelineFromPath({
        trackId: 'v1',
        name: 'bad.mp4',
        path: 'video/bad.mp4',
      }),
    ).rejects.toThrow('Failed to resolve media metadata');
  });

  it('catches auto-proxy rejection without failing import', async () => {
    const proxyError = new Error('proxy failed');
    const deps = makeDeps({
      getOrFetchMetadataByPath: vi.fn().mockResolvedValue({
        duration: 10,
        video: { width: 1920, height: 1080, fps: 30 },
      }),
      getUserSettings: vi.fn(() => ({
        optimization: { autoCreateProxies: true },
        projectDefaults: { defaultAudioFadeCurve: 'linear' as const },
      })),
      mediaCache: {
        hasProxy: vi.fn(() => false),
        ensureProxy: vi.fn().mockRejectedValue(proxyError),
      },
    });
    const service = createTimelineCommandService(deps);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await service.addClipToTimelineFromPath({
      trackId: 'v1',
      name: 'clip.mp4',
      path: 'video/clip.mp4',
    });

    // Should resolve without throwing because catch is attached
    expect(deps.applyTimeline).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('uses secondsToUs for video duration', async () => {
    const deps = makeDeps({
      getOrFetchMetadataByPath: vi.fn().mockResolvedValue({
        duration: 1.033_333,
        video: { width: 1920, height: 1080, fps: 30 },
      }),
    });
    const service = createTimelineCommandService(deps);
    await service.addClipToTimelineFromPath({
      trackId: 'v1',
      name: 'clip.mp4',
      path: 'video/clip.mp4',
    });

    const cmd = (deps.applyTimeline as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cmd.durationUs).toBe(1_033_333);
  });

  it('uses defaultImageDurationUs for image-like files', async () => {
    const deps = makeDeps({
      getOrFetchMetadataByPath: vi.fn().mockResolvedValue({
        duration: 0,
        image: { width: 100, height: 100 },
      }),
    });
    const service = createTimelineCommandService(deps);
    await service.addClipToTimelineFromPath({
      trackId: 'v1',
      name: 'img.jpg',
      path: 'images/img.jpg',
    });

    const cmd = (deps.applyTimeline as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cmd.durationUs).toBe(5_000_000);
    expect(cmd.isImage).toBe(true);
  });

  it('lets pseudo overlap command cut the existing clip without trimming the dropped clip first', async () => {
    const track = {
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          id: 'existing',
          clipType: 'media',
          name: 'Existing',
          source: { path: 'video/existing.mp4' },
          sourceRange: { startUs: 0, durationUs: 2_000_000 },
          sourceDurationUs: 2_000_000,
          timelineRange: { startUs: 0, durationUs: 2_000_000 },
        },
      ],
    };
    const deps = makeDeps({
      getTimelineDoc: vi.fn(() => ({
        timebase: { fps: 30 },
        tracks: [track],
      })),
      getTrackById: vi.fn(() => track),
      getOrFetchMetadataByPath: vi.fn().mockResolvedValue({
        duration: 4,
        video: { width: 1920, height: 1080, fps: 30 },
      }),
    });
    const service = createTimelineCommandService(deps);

    const result = await service.addClipToTimelineFromPath({
      trackId: 'v1',
      name: 'clip.mp4',
      path: 'video/clip.mp4',
      startUs: 1_000_000,
      pseudo: true,
    });

    const cmd = (deps.applyTimeline as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cmd.startUs).toBe(1_000_000);
    expect(cmd.durationUs).toBe(4_000_000);
    expect(cmd.sourceRange).toEqual({ startUs: 0, durationUs: 4_000_000 });
    expect(cmd.pseudo).toBe(true);
    expect(result.durationUs).toBe(4_000_000);
    expect(result.warnings).toBeUndefined();
  });
});
