import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref, nextTick } from 'vue';
import TimelineAudioWaveform from '~/components/timeline/audio/TimelineAudioWaveform.vue';

const mockMediaStore = reactive({
  mediaMetadata: {} as Record<string, any>,
  getCachedMetadata: vi.fn((path: string) => {
    if (!path) return undefined;
    const direct = mockMediaStore.mediaMetadata[path];
    if (direct) return direct;
    if (path.startsWith('external:')) {
      const clean = path.slice('external:'.length);
      return mockMediaStore.mediaMetadata[clean];
    }
    const prefixed = `external:${path}`;
    return mockMediaStore.mediaMetadata[prefixed];
  }),
  getOrFetchMetadataByPath: vi.fn(),
  extractPeaks: vi.fn(),
  setAudioPeaks: vi.fn(),
});

const mockTimelineStore = reactive({
  timelineZoom: 1,
  timelineViewportWidth: 1920,
  timelineScrollLeftPx: 0,
  timelineDoc: { tracks: [] },
  isPlaying: false,
  audioMuted: false,
});

const mockProjectStore = reactive({
  currentProjectId: 'project-1',
});

const mockVfs = {
  getFile: vi.fn(),
};

vi.mock('~/stores/media.store', () => ({ useMediaStore: () => mockMediaStore }));
vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => mockTimelineStore }));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => mockProjectStore }));
vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({ vfs: mockVfs }),
}));

// Suppress canvas and ResizeObserver-dependent logic for unit tests
vi.mock('~/utils/audio/waveform-extraction-queue', () => ({
  runQueuedPeakExtraction: vi.fn(),
}));

const baseItem = {
  id: 'clip-1',
  kind: 'clip' as const,
  trackId: 'track-1',
  clipType: 'media' as const,
  name: 'Test Clip',
  timelineRange: { startUs: 0, durationUs: 5_000_000 },
  sourceRange: { startUs: 0, durationUs: 5_000_000 },
  sourceDurationUs: 0,
  source: { path: 'media.mp4' },
  speed: 1,
  audioGain: 1,
  audioMuted: false,
  disabled: false,
  audioWaveformMode: 'half' as const,
};

async function mountComponent(props = { item: baseItem }) {
  return await mountSuspended(TimelineAudioWaveform, {
    props,
    global: {
      stubs: {
        UTooltip: { template: '<span><slot /></span>' },
      },
    },
  });
}

describe('TimelineAudioWaveform.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMediaStore.mediaMetadata = {};
    mockTimelineStore.isPlaying = false;
  });

  describe('getMetadataForPath logic (effectiveSourceDurationUs)', () => {
    it('uses explicit sourceDurationUs when available', async () => {
      const item = {
        ...baseItem,
        sourceDurationUs: 10_000_000,
      };
      const wrapper = await mountComponent({ item });

      expect((wrapper.vm as any).effectiveSourceDurationUs).toBe(10_000_000);
    });

    it('resolves metadata by direct path', async () => {
      mockMediaStore.mediaMetadata['media.mp4'] = { duration: 12 };
      const wrapper = await mountComponent();

      expect((wrapper.vm as any).effectiveSourceDurationUs).toBe(12_000_000);
    });

    it('resolves metadata when path has external: prefix', async () => {
      mockMediaStore.mediaMetadata['external:media.mp4'] = { duration: 15 };
      const item = {
        ...baseItem,
        source: { path: 'external:media.mp4' },
      };
      const wrapper = await mountComponent({ item });

      expect((wrapper.vm as any).effectiveSourceDurationUs).toBe(15_000_000);
    });

    it('resolves metadata by unprefixed path when store key is prefixed', async () => {
      mockMediaStore.mediaMetadata['external:media.mp4'] = { duration: 8 };
      const wrapper = await mountComponent();

      expect((wrapper.vm as any).effectiveSourceDurationUs).toBe(8_000_000);
    });

    it('falls back to sourceRange end when no metadata and no explicit duration', async () => {
      const item = {
        ...baseItem,
        sourceDurationUs: 0,
        sourceRange: { startUs: 1_000_000, durationUs: 4_000_000 },
      };
      const wrapper = await mountComponent({ item });

      expect((wrapper.vm as any).effectiveSourceDurationUs).toBe(5_000_000);
    });
  });

  describe('audioPeaks', () => {
    it('returns null when no fileUrl', async () => {
      const item = { ...baseItem, source: { path: '' } };
      const wrapper = await mountComponent({ item });

      expect((wrapper.vm as any).audioPeaks).toBeNull();
    });

    it('returns peaks from metadata by direct path', async () => {
      const peaks = [new Float32Array([0.5, 0.8])];
      mockMediaStore.mediaMetadata['media.mp4'] = { audioPeaks: peaks };
      const wrapper = await mountComponent();

      expect((wrapper.vm as any).audioPeaks).toStrictEqual(peaks);
    });

    it('returns peaks from metadata via external: prefix fallback', async () => {
      const peaks = [new Float32Array([0.2, 0.4])];
      mockMediaStore.mediaMetadata['external:media.mp4'] = { audioPeaks: peaks };
      const wrapper = await mountComponent();

      expect((wrapper.vm as any).audioPeaks).toStrictEqual(peaks);
    });
  });

  describe('ensureMediaPeaks', () => {
    it('returns existing peaks from metadata without calling extraction', async () => {
      const peaks = [new Float32Array(100).fill(0.3)];
      mockMediaStore.mediaMetadata['media.mp4'] = { audioPeaks: peaks };
      mockTimelineStore.isPlaying = true;
      const wrapper = await mountComponent();

      const result = await (wrapper.vm as any).ensureMediaPeaks({
        path: 'media.mp4',
        maxLength: 100,
      });

      expect(result).toStrictEqual(peaks);
      expect(mockMediaStore.getOrFetchMetadataByPath).not.toHaveBeenCalled();
    });

    it('calls fileManager.vfs.getFile instead of projectStore.getFileByPath', async () => {
      const fileMock = new File([], 'media.mp4');
      mockVfs.getFile.mockResolvedValue(fileMock);
      mockMediaStore.getOrFetchMetadataByPath.mockResolvedValue({});

      const { runQueuedPeakExtraction } = await import('~/utils/audio/waveform-extraction-queue');
      vi.mocked(runQueuedPeakExtraction).mockImplementation(async ({ task }: any) => task());

      const wrapper = await mountComponent();
      await (wrapper.vm as any).ensureMediaPeaks({
        path: 'media.mp4',
        maxLength: 100,
      });

      expect(mockVfs.getFile).toHaveBeenCalledWith('media.mp4');
    });

    it('re-extracts peaks when cached peaks are below the requested precision', async () => {
      const fileMock = new File([], 'media.mp4');
      const precisePeaks = [new Float32Array(100).fill(0.5)];
      mockMediaStore.mediaMetadata['media.mp4'] = { audioPeaks: [new Float32Array(2)] };
      mockVfs.getFile.mockResolvedValue(fileMock);
      mockMediaStore.getOrFetchMetadataByPath.mockResolvedValue({});
      mockMediaStore.extractPeaks.mockResolvedValue(precisePeaks);

      const { runQueuedPeakExtraction } = await import('~/utils/audio/waveform-extraction-queue');
      vi.mocked(runQueuedPeakExtraction).mockImplementation(async ({ task }: any) => task());

      const wrapper = await mountComponent();
      const result = await (wrapper.vm as any).ensureMediaPeaks({
        path: 'media.mp4',
        maxLength: 100,
      });

      expect(result).toStrictEqual(precisePeaks);
      expect(mockMediaStore.extractPeaks).toHaveBeenCalledWith(fileMock, 'media.mp4', {
        maxLength: 100,
        precision: 10000,
      });
    });

    it('logs an error when the source file cannot be loaded for waveform extraction', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockVfs.getFile.mockResolvedValue(null);
      mockMediaStore.getOrFetchMetadataByPath.mockResolvedValue({ duration: 5 });

      const { runQueuedPeakExtraction } = await import('~/utils/audio/waveform-extraction-queue');
      vi.mocked(runQueuedPeakExtraction).mockImplementation(async ({ task }: any) => task());

      const wrapper = await mountComponent();
      await (wrapper.vm as any).ensureMediaPeaks({
        path: 'media.mp4',
        maxLength: 100,
      });

      expect(errorSpy).toHaveBeenCalledWith(
        '[TimelineAudioWaveform]',
        'Failed to load source file for waveform extraction:',
        'media.mp4',
      );
      errorSpy.mockRestore();
    });

    it('logs an error and does not cache empty extraction results', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const fileMock = new File([], 'media.mp4');
      mockVfs.getFile.mockResolvedValue(fileMock);
      mockMediaStore.getOrFetchMetadataByPath.mockResolvedValue({ duration: 5 });
      mockMediaStore.extractPeaks.mockResolvedValue([]);

      const { runQueuedPeakExtraction } = await import('~/utils/audio/waveform-extraction-queue');
      vi.mocked(runQueuedPeakExtraction).mockImplementation(async ({ task }: any) => task());

      const wrapper = await mountComponent();
      const result = await (wrapper.vm as any).ensureMediaPeaks({
        path: 'media.mp4',
        maxLength: 100,
      });

      expect(result).toBeNull();
      expect(mockMediaStore.setAudioPeaks).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        '[TimelineAudioWaveform]',
        'Waveform extraction returned no peaks:',
        'media.mp4',
      );
      errorSpy.mockRestore();
    });
  });
});
