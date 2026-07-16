import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref, nextTick } from 'vue';
import TimelineAudioWaveform from '~/components/timeline/audio/TimelineAudioWaveform.vue';
import { __resetWaveformSchedulerForTests } from '~/utils/audio/waveform-render-scheduler';
import { timeUsToPx } from '~/utils/timeline/geometry';
import { TICKS_PER_MICROSECOND, TICKS_PER_SECOND } from '~/utils/time';
import type { TimelineClipItem } from '~/timeline/types';

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
  selectedItemIds: [] as string[],
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
  WAVEFORM_EXTRACTION_PRIORITIES: {
    prefetch: 0,
    nestedTimeline: 1,
    visibleClip: 2,
    selectedClip: 3,
  },
  runQueuedPeakExtraction: vi.fn(),
}));

const baseItem: TimelineClipItem = {
  id: 'clip-1',
  kind: 'clip' as const,
  trackId: 'track-1',
  clipType: 'media' as const,
  name: 'Test Clip',
  timelineRange: { startTicks: 0, durationTicks: 5 * TICKS_PER_SECOND },
  sourceRange: { startTicks: 0, durationTicks: 5 * TICKS_PER_SECOND },
  sourceDurationTicks: 0,
  source: { path: 'media.mp4' },
  speed: 1,
  audioGain: 1,
  audioMuted: false,
  disabled: false,
  audioWaveformMode: 'half' as const,
};

const mountedWrappers: Array<{ unmount: () => void }> = [];

interface MountComponentProps {
  item: TimelineClipItem;
  scrollLeft?: number;
  viewportWidth?: number;
}

async function mountComponent(props: MountComponentProps = { item: baseItem }) {
  const wrapper = await mountSuspended(TimelineAudioWaveform, {
    props,
    global: {
      stubs: {
        UTooltip: { template: '<span><slot /></span>' },
      },
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

describe('TimelineAudioWaveform.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The waveform is painted into an offscreen canvas and presented as an <img>;
    // jsdom has no real toDataURL, so stub it to a deterministic data URL.
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,iVBORw0KGgo=',
    );
    __resetWaveformSchedulerForTests();
    mockMediaStore.mediaMetadata = {};
    mockTimelineStore.isPlaying = false;
    mockTimelineStore.timelineZoom = 1;
    mockTimelineStore.timelineViewportWidth = 1920;
    mockTimelineStore.timelineScrollLeftPx = 0;
  });

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    __resetWaveformSchedulerForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('getMetadataForPath logic (effectiveSourceDurationTicks)', () => {
    it('uses explicit sourceDurationTicks when available', async () => {
      const item = {
        ...baseItem,
        sourceDurationTicks: 10 * TICKS_PER_SECOND,
      };
      const wrapper = await mountComponent({ item });

      expect((wrapper.vm as any).effectiveSourceDurationTicks).toBe(10 * TICKS_PER_SECOND);
    });

    it('does not let sourceDurationTicks truncate a later trimmed source range', async () => {
      const item = {
        ...baseItem,
        sourceDurationTicks: 3 * TICKS_PER_SECOND,
        sourceRange: { startTicks: 8 * TICKS_PER_SECOND, durationTicks: 2 * TICKS_PER_SECOND },
      };
      const wrapper = await mountComponent({ item });

      expect((wrapper.vm as any).effectiveSourceDurationTicks).toBe(10 * TICKS_PER_SECOND);
    });

    it('resolves metadata by direct path', async () => {
      mockMediaStore.mediaMetadata['media.mp4'] = { duration: 12 };
      const wrapper = await mountComponent();

      expect((wrapper.vm as any).effectiveSourceDurationTicks).toBe(12 * TICKS_PER_SECOND);
    });

    it('resolves metadata when path has external: prefix', async () => {
      mockMediaStore.mediaMetadata['external:media.mp4'] = { duration: 15 };
      const item = {
        ...baseItem,
        source: { path: 'external:media.mp4' },
      };
      const wrapper = await mountComponent({ item });

      expect((wrapper.vm as any).effectiveSourceDurationTicks).toBe(15 * TICKS_PER_SECOND);
    });

    it('resolves metadata by unprefixed path when store key is prefixed', async () => {
      mockMediaStore.mediaMetadata['external:media.mp4'] = { duration: 8 };
      const wrapper = await mountComponent();

      expect((wrapper.vm as any).effectiveSourceDurationTicks).toBe(8 * TICKS_PER_SECOND);
    });

    it('falls back to sourceRange end when no metadata and no explicit duration', async () => {
      const item = {
        ...baseItem,
        sourceDurationTicks: 0,
        sourceRange: { startTicks: TICKS_PER_SECOND, durationTicks: 4 * TICKS_PER_SECOND },
      };
      const wrapper = await mountComponent({ item });

      expect((wrapper.vm as any).effectiveSourceDurationTicks).toBe(5 * TICKS_PER_SECOND);
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

    it('does not log an error when the file has no active audio track', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const fileMock = new File([], 'media.mp4');
      mockVfs.getFile.mockResolvedValue(fileMock);
      mockMediaStore.getOrFetchMetadataByPath.mockResolvedValue({ duration: 5 });
      mockMediaStore.extractPeaks.mockRejectedValue(new Error('no active audio track found'));

      const { runQueuedPeakExtraction } = await import('~/utils/audio/waveform-extraction-queue');
      vi.mocked(runQueuedPeakExtraction).mockImplementation(async ({ task }: any) => task());

      const wrapper = await mountComponent();
      await (wrapper.vm as any).ensureMediaPeaks({
        path: 'media.mp4',
        maxLength: 100,
      });

      expect(errorSpy).not.toHaveBeenCalledWith(
        '[TimelineAudioWaveform]',
        'Failed to extract peaks:',
        expect.anything(),
      );
      errorSpy.mockRestore();
    });
  });

  describe('extraction lifecycle', () => {
    it('requests higher-resolution peaks when source duration becomes available after mount', async () => {
      const fileMock = new File([], 'media.mp4');
      mockVfs.getFile.mockResolvedValue(fileMock);
      mockMediaStore.getOrFetchMetadataByPath.mockResolvedValue({});
      mockMediaStore.extractPeaks.mockResolvedValue([new Float32Array(240_000).fill(0.5)]);

      const { runQueuedPeakExtraction } = await import('~/utils/audio/waveform-extraction-queue');
      vi.mocked(runQueuedPeakExtraction).mockImplementation(async ({ task }: any) => task());

      await mountComponent();
      await nextTick();

      expect(mockMediaStore.extractPeaks).toHaveBeenCalledWith(fileMock, 'media.mp4', {
        maxLength: 240_000,
        precision: 10000,
        durationS: 5,
      });

      mockMediaStore.extractPeaks.mockClear();
      mockMediaStore.mediaMetadata['media.mp4'] = {
        duration: 10,
        audio: { codec: 'aac', parsedCodec: 'aac', sampleRate: 48000, channels: 2 },
        audioPeaks: [new Float32Array(240_000).fill(0.5)],
        source: { size: 1, lastModified: 1 },
      };
      await nextTick();

      await vi.waitFor(() => {
        expect(mockMediaStore.extractPeaks).toHaveBeenCalledWith(fileMock, 'media.mp4', {
          maxLength: 480_000,
          precision: 10000,
          durationS: 10,
        });
      });
    });
  });

  describe('render lifecycle', () => {
    it('redraws after a zoom change even when rounded canvas geometry is unchanged', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        return window.setTimeout(() => callback(0), 0);
      });
      vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));

      const fill = vi.fn();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        beginPath: vi.fn(),
        clearRect: vi.fn(),
        closePath: vi.fn(),
        fill,
        lineTo: vi.fn(),
        moveTo: vi.fn(),
        fillStyle: '',
      } as unknown as CanvasRenderingContext2D);

      mockTimelineStore.timelineZoom = 50;
      mockMediaStore.mediaMetadata['media.mp4'] = {
        duration: 5,
        audioPeaks: [new Float32Array(240_000).fill(0.5)],
      };

      await mountComponent();
      await nextTick();
      await vi.advanceTimersByTimeAsync(0);

      const callsBeforeZoom = fill.mock.calls.length;
      expect(callsBeforeZoom).toBeGreaterThan(0);

      mockTimelineStore.timelineZoom = 50.01;
      await nextTick();
      await vi.advanceTimersByTimeAsync(121);
      await vi.advanceTimersByTimeAsync(0);

      expect(fill.mock.calls.length).toBeGreaterThan(callsBeforeZoom);
    });

    it('keeps the painted window stable while scrolling within overscan, repaints past its edge', async () => {
      // Run the redraw scheduler synchronously (rAF fires immediately) so these
      // assertions don't depend on the frame-budget timing the global scheduler
      // shares with other clips mounted by earlier tests in this file.
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      });
      vi.stubGlobal('cancelAnimationFrame', () => undefined);

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        beginPath: vi.fn(),
        clearRect: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        lineTo: vi.fn(),
        moveTo: vi.fn(),
        fillStyle: '',
      } as unknown as CanvasRenderingContext2D);

      mockTimelineStore.timelineZoom = 50; // 10 px/s
      mockTimelineStore.timelineViewportWidth = 1920;
      mockTimelineStore.timelineScrollLeftPx = 0;

      // 2000 s clip → 20000 px strip → exceeds STATIC_MAX_PX, so it uses the
      // windowed (scrolled) canvas path. Peaks are at full resolution so no
      // extraction is triggered. We assert on this component's own
      // `renderedFrac` (the painted source-fraction), which only changes when the
      // backing store is actually re-rasterized.
      const item = {
        ...baseItem,
        timelineRange: { startTicks: 0, durationTicks: 2000 * TICKS_PER_SECOND },
        sourceRange: { startTicks: 0, durationTicks: 2000 * TICKS_PER_SECOND },
        sourceDurationTicks: 2000 * TICKS_PER_SECOND,
      };
      mockMediaStore.mediaMetadata['media.mp4'] = {
        duration: 2000,
        audioPeaks: [new Float32Array(500_000).fill(0.5)],
      };

      const wrapper = await mountComponent({ item });
      const vm = wrapper.vm as any;
      await nextTick();

      const painted = vm.renderedFrac;
      expect(painted).not.toBeNull();
      expect(painted.start).toBe(0);
      expect(painted.width).toBeCloseTo(2920 / 20000, 5);

      // Small scroll stays inside the rendered overscan → no re-rasterization, so
      // the painted fraction object is left untouched (same reference).
      mockTimelineStore.timelineScrollLeftPx = 400;
      await nextTick();
      expect(vm.renderedFrac).toBe(painted);

      // Scrolling past the painted window's edge forces a repaint to a new window.
      mockTimelineStore.timelineScrollLeftPx = 5000;
      await nextTick();
      expect(vm.renderedFrac).not.toBe(painted);
      expect(vm.renderedFrac.start).toBeGreaterThan(0);
    });

    it('keeps a trimmed audio waveform covering the viewport after crossing into windowed rendering', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        return window.setTimeout(() => callback(0), 0);
      });
      vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        beginPath: vi.fn(),
        clearRect: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        lineTo: vi.fn(),
        moveTo: vi.fn(),
        fillStyle: '',
      } as unknown as CanvasRenderingContext2D);

      const item = {
        ...baseItem,
        timelineRange: { startTicks: 58 * TICKS_PER_SECOND, durationTicks: 16 * TICKS_PER_SECOND },
        sourceRange: { startTicks: 40 * TICKS_PER_SECOND, durationTicks: 16 * TICKS_PER_SECOND },
        sourceDurationTicks: 120 * TICKS_PER_SECOND,
      };
      mockMediaStore.mediaMetadata['media.mp4'] = {
        duration: 120,
        audioPeaks: [new Float32Array(500_000).fill(0.5)],
      };
      mockTimelineStore.timelineViewportWidth = 1180;
      mockTimelineStore.timelineZoom = 69;
      mockTimelineStore.timelineScrollLeftPx = timeUsToPx(item.timelineRange.startTicks, 69);

      const initialScrollLeft = timeUsToPx(item.timelineRange.startTicks, 69);
      const wrapper = await mountComponent({
        item,
        // TimelineTracks v-memo can leave this prop at the pre-zoom value.
        scrollLeft: initialScrollLeft,
        viewportWidth: 1180,
      });
      await nextTick();
      await vi.advanceTimersByTimeAsync(0);

      const vm = wrapper.vm as any;
      expect(vm.totalWidthPx).toBeLessThanOrEqual(8000);

      mockTimelineStore.timelineZoom = 70;
      const anchoredScrollLeft = timeUsToPx(item.timelineRange.startTicks, 70);
      mockTimelineStore.timelineScrollLeftPx = anchoredScrollLeft;
      await nextTick();
      await vi.advanceTimersByTimeAsync(121);
      await vi.advanceTimersByTimeAsync(0);
      await nextTick();

      expect(vm.totalWidthPx).toBeGreaterThan(8000);
      expect(wrapper.props('scrollLeft')).toBe(initialScrollLeft);

      const expectedVisibleLeft = anchoredScrollLeft - (vm.clipStartPx + vm.waveformLeftPx);
      expect(vm.coreWindow.leftPx).toBe(Math.floor(expectedVisibleLeft));

      const img = wrapper.find('img').element as HTMLImageElement;
      const canvasHost = img.parentElement as HTMLElement;
      expect(canvasHost.style.left).toMatch(/px$/);
      expect(canvasHost.style.width).toMatch(/px$/);

      const canvasLeftInClip = Number.parseFloat(canvasHost.style.left);
      const canvasRightInClip = canvasLeftInClip + Number.parseFloat(canvasHost.style.width);
      const visibleWidth = Math.min(
        mockTimelineStore.timelineViewportWidth,
        vm.waveformMetrics.clipWidthPx,
      );

      expect(canvasLeftInClip).toBeLessThanOrEqual(0);
      expect(canvasRightInClip).toBeGreaterThanOrEqual(visibleWidth);
    });

    it.each([
      { speed: 1, expectedTransform: '' },
      { speed: -1, expectedTransform: 'scaleX(-1)' },
    ])(
      'keeps only a viewport-sized canvas at extreme zoom for speed $speed',
      async ({ speed, expectedTransform }) => {
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
          callback(0);
          return 0;
        });
        vi.stubGlobal('cancelAnimationFrame', () => undefined);

        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
          beginPath: vi.fn(),
          clearRect: vi.fn(),
          closePath: vi.fn(),
          fill: vi.fn(),
          lineTo: vi.fn(),
          moveTo: vi.fn(),
          fillStyle: '',
        } as unknown as CanvasRenderingContext2D);

        const item: TimelineClipItem = {
          ...baseItem,
          speed,
          timelineRange: { startTicks: 58 * TICKS_PER_SECOND, durationTicks: 16 * TICKS_PER_SECOND },
          sourceRange: { startTicks: 4 * TICKS_PER_SECOND, durationTicks: 16 * TICKS_PER_SECOND },
          sourceDurationTicks: 10_800 * TICKS_PER_SECOND,
        };
        mockMediaStore.mediaMetadata['media.mp4'] = {
          duration: 10_800,
          audioPeaks: [new Float32Array(500_000).fill(0.5)],
        };
        mockTimelineStore.timelineViewportWidth = 1180;
        mockTimelineStore.timelineZoom = 102;
        mockTimelineStore.timelineScrollLeftPx = timeUsToPx(item.timelineRange.startTicks, 102);

        const wrapper = await mountComponent({ item });
        await nextTick();

        const vm = wrapper.vm as any;
        expect(vm.totalWidthPx).toBeGreaterThan(10_000_000);

        const img = wrapper.find('img').element as HTMLImageElement;
        const canvasHost = img.parentElement as HTMLElement;
        const canvasLeftInClip = Number.parseFloat(canvasHost.style.left);
        const canvasWidth = Number.parseFloat(canvasHost.style.width);

        expect(Math.abs(canvasLeftInClip)).toBeLessThanOrEqual(1001);
        expect(canvasWidth).toBeLessThanOrEqual(3181);
        expect(img.style.transform).toBe(expectedTransform);
        expect(img.style.left).toBe('0px');
        expect(canvasHost.parentElement).toBe(wrapper.element);
      },
    );

    it('keeps the canvas at local x=0 when the real clip viewport offset exceeds 64K px', async () => {
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      });
      vi.stubGlobal('cancelAnimationFrame', () => undefined);

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        beginPath: vi.fn(),
        clearRect: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        lineTo: vi.fn(),
        moveTo: vi.fn(),
        fillStyle: '',
      } as unknown as CanvasRenderingContext2D);

      const item: TimelineClipItem = {
        ...baseItem,
        timelineRange: {
          startTicks: 440_000 * TICKS_PER_MICROSECOND,
          durationTicks: 243_680_000 * TICKS_PER_MICROSECOND,
        },
        sourceRange: {
          startTicks: 480_000 * TICKS_PER_MICROSECOND,
          durationTicks: 243_680_000 * TICKS_PER_MICROSECOND,
        },
        sourceDurationTicks: 1_160_753_167 * TICKS_PER_MICROSECOND,
      };
      mockMediaStore.mediaMetadata['media.mp4'] = {
        duration: 1160.753167,
        audioPeaks: [new Float32Array(500_000).fill(0.5)],
      };
      mockTimelineStore.timelineViewportWidth = 1180;
      mockTimelineStore.timelineZoom = 102;
      mockTimelineStore.timelineScrollLeftPx =
        timeUsToPx(46_480_000 * TICKS_PER_MICROSECOND, 102) - 590;

      const wrapper = await mountComponent({ item });
      await nextTick();

      const img = wrapper.find('img').element as HTMLImageElement;
      const canvasHost = img.parentElement as HTMLElement;

      expect(Number.parseFloat(canvasHost.style.left)).toBeGreaterThan(65_536);
      expect(Number.parseFloat(canvasHost.style.width)).toBeLessThanOrEqual(3181);
      expect(img.style.left).toBe('0px');
      expect(img.style.width).toBe('100%');
    });
  });
});
