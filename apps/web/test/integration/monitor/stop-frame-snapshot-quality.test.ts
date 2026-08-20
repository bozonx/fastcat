/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineDocument } from '~/timeline/types';

const mediaProcessorMock = vi.hoisted(() => ({
  extractTimelineFrameBlob: vi.fn(),
}));

const projectStoreMock = vi.hoisted(() => ({
  projectSettings: {
    project: {
      width: 3840,
      height: 2160,
      fps: 60,
      resolutionFormat: '2160p',
      orientation: 'landscape',
      aspectRatio: '16:9',
      isCustomResolution: true,
      sampleRate: 48000,
    },
  },
}));

vi.mock('~/composables/useMediaProcessor', () => ({
  useMediaProcessor: () => mediaProcessorMock,
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => projectStoreMock,
}));

describe('stop-frame snapshot export quality integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders monitor snapshots through the active media processor at full export dimensions', async () => {
    const expectedBlob = new Blob(['export-frame'], { type: 'image/webp' });
    mediaProcessorMock.extractTimelineFrameBlob.mockResolvedValueOnce(expectedBlob);

    const timelineDoc: TimelineDocument = {
      timebase: { fps: 30 },
      tracks: [],
      metadata: {
        fastcat: {
          masterGain: 1,
          masterMuted: false,
          format: {
            width: 1280,
            height: 720,
            fps: 30,
            resolutionFormat: '720p',
            orientation: 'landscape',
            aspectRatio: '16:9',
            isCustomResolution: false,
            sampleRate: 48000,
            isAutoSettings: true,
            settingsSource: 'projectDefaults',
            useProjectSettings: true,
          },
        },
      },
    };

    const { renderStopFrameWebp } = await import('~/timeline/timeline-thumbnail');
    const blob = await renderStopFrameWebp({
      timelineDoc,
      timeTicks: 1_500_000,
      quality: 0.92,
    });

    expect(blob).toBe(expectedBlob);
    expect(mediaProcessorMock.extractTimelineFrameBlob).toHaveBeenCalledWith({
      timelineDoc,
      timeTicks: 1_500_000,
      width: 3840,
      height: 2160,
      quality: 0.92,
      isExport: true,
    });
  });

  it('keeps timeline manual dimensions when the timeline is detached from project defaults', async () => {
    mediaProcessorMock.extractTimelineFrameBlob.mockResolvedValueOnce(
      new Blob(['manual-frame'], { type: 'image/webp' }),
    );

    const timelineDoc: TimelineDocument = {
      timebase: { fps: 24 },
      tracks: [],
      metadata: {
        fastcat: {
          masterGain: 1,
          masterMuted: false,
          format: {
            width: 1080,
            height: 1920,
            fps: 24,
            resolutionFormat: 'custom',
            orientation: 'portrait',
            aspectRatio: '9:16',
            isCustomResolution: true,
            sampleRate: 48000,
            isAutoSettings: false,
            settingsSource: 'manual',
            useProjectSettings: false,
          },
        },
      },
    };

    const { renderStopFrameWebp } = await import('~/timeline/timeline-thumbnail');
    await renderStopFrameWebp({
      timelineDoc,
      timeTicks: 250_000,
      quality: 1,
    });

    expect(mediaProcessorMock.extractTimelineFrameBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 1080,
        height: 1920,
        isExport: true,
      }),
    );
  });
});
