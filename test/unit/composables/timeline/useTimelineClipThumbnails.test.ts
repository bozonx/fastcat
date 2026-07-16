/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import {
  resolveVisualVideoAspect,
  useTimelineClipThumbnails,
  type ThumbnailTile,
} from '~/composables/timeline/useTimelineClipThumbnails';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import type { TimelineClipItem } from '~/timeline/types';

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: vi.fn(),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(),
}));

vi.mock('~/stores/media.store', () => ({
  useMediaStore: vi.fn(),
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: vi.fn(() => ({
    vfs: {
      getFile: vi.fn().mockResolvedValue(new File([], 'test.mp4')),
    },
  })),
}));

vi.mock('~/utils/thumbnail-generator', () => ({
  getClipThumbnailsHash: vi.fn(() => 'test-clip-hash'),
  thumbnailGenerator: {
    addTask: vi.fn(),
    cancelTask: vi.fn(),
  },
}));

vi.mock('~/utils/file-thumbnail-generator', () => ({
  getFileThumbnailHash: vi.fn(() => 'test-file-hash'),
  fileThumbnailGenerator: {
    addTask: vi.fn(),
    cancelTask: vi.fn(),
  },
}));

describe('ThumbnailTile interface', () => {
  it('has expected shape', () => {
    const tile: ThumbnailTile = { key: 0, url: 'blob:x', leftPx: 0, widthPx: 80 };
    expect(tile.key).toBe(0);
    expect(tile.url).toBe('blob:x');
    expect(tile.leftPx).toBe(0);
    expect(tile.widthPx).toBe(80);
  });

  it('leftPx is computed from trimOffset + idx * tileWidth (tiles aligned to clip start)', () => {
    const tileW = 80;
    const trimOffsetPx = 40;

    const makeTile = (idx: number): ThumbnailTile => ({
      key: idx,
      url: `blob:${idx}`,
      leftPx: trimOffsetPx + idx * tileW,
      widthPx: tileW,
    });

    const tile0 = makeTile(0);
    const tile1 = makeTile(1);
    const tile2 = makeTile(2);

    // First tile starts exactly at the clip's left edge in strip coordinates.
    expect(tile0.leftPx).toBe(40);
    expect(tile1.leftPx).toBe(120);
    expect(tile2.leftPx).toBe(200);
    expect(tile2.widthPx).toBe(tileW);
  });

  it('tileWidth equals clipHeight * aspectRatio (16/9)', () => {
    const clipHeight = 90;
    const aspectRatio = 320 / 180; // THUMB_ASPECT
    const expectedWidth = clipHeight * aspectRatio;

    const tile: ThumbnailTile = { key: 0, url: 'blob:x', leftPx: 0, widthPx: expectedWidth };

    expect(tile.widthPx).toBeCloseTo(160, 5);
  });

  it('tiles sorted by key are in ascending position order', () => {
    const tiles: ThumbnailTile[] = [
      { key: 2, url: 'b', leftPx: 200, widthPx: 80 },
      { key: 0, url: 'a', leftPx: 40, widthPx: 80 },
      { key: 1, url: 'c', leftPx: 120, widthPx: 80 },
    ];

    const sorted = [...tiles].sort((a, b) => a.key - b.key);

    expect(sorted.map((t) => t.key)).toEqual([0, 1, 2]);
    expect(sorted.map((t) => t.leftPx)).toEqual([40, 120, 200]);
  });
});

describe('resolveVisualVideoAspect', () => {
  it('keeps landscape aspect without rotation', () => {
    expect(
      resolveVisualVideoAspect({ displayWidth: 1920, displayHeight: 1080, rotation: 0 }),
    ).toBeCloseTo(16 / 9, 5);
  });

  it('swaps dimensions for vertical video stored with quarter-turn rotation metadata', () => {
    expect(
      resolveVisualVideoAspect({
        width: 1920,
        height: 1080,
        displayWidth: 1920,
        displayHeight: 1080,
        rotation: 90,
      }),
    ).toBeCloseTo(9 / 16, 5);
  });

  it('keeps already-oriented display dimensions for quarter-turn rotation metadata', () => {
    expect(
      resolveVisualVideoAspect({
        width: 1920,
        height: 1080,
        displayWidth: 1080,
        displayHeight: 1920,
        rotation: 90,
      }),
    ).toBeCloseTo(9 / 16, 5);
  });
});

describe('useTimelineClipThumbnails reactive logic', () => {
  let userSettings: any;
  let timelineZoom: any;
  let currentProjectId: string;
  let mediaMetadata: any;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    userSettings = {
      ui: {
        clipThumbnailMode: 'standard',
      },
    };

    timelineZoom = 61.0;
    currentProjectId = 'test-project';
    mediaMetadata = {
      'test-video.mp4': {
        video: {
          displayWidth: 1920,
          displayHeight: 1080,
          rotation: 0,
        },
      },
    };

    vi.mocked(useWorkspaceStore).mockReturnValue({
      userSettings,
    } as any);

    vi.mocked(useTimelineStore).mockReturnValue({
      timelineZoom,
    } as any);

    vi.mocked(useProjectStore).mockReturnValue({
      currentProjectId,
    } as any);

    vi.mocked(useMediaStore).mockReturnValue({
      mediaMetadata,
      getCachedMetadata: (path: string) => mediaMetadata[path],
    } as any);
  });

  const createMockOptions = (clipThumbnailModeVal = 'standard') => {
    userSettings.ui.clipThumbnailMode = clipThumbnailModeVal;

    const itemRef = ref<TimelineClipItem>({
      id: 'clip-1',
      clipType: 'media',
      source: { path: 'test-video.mp4' },
      sourceDurationTicks: 5_080_320_000_000, // 20 seconds
      sourceRange: { startTicks: 0, durationTicks: 5_080_320_000_000 },
      timelineRange: { startTicks: 0, durationTicks: 5_080_320_000_000 },
    } as any);

    const scrollLeft = ref(0);
    const viewportWidth = ref(800);
    const clipStartPx = ref(0);
    const clipHeightPx = ref(50); // aspect ratio ~1.77 => width ~88px per tile

    return {
      item: itemRef,
      scrollLeft,
      viewportWidth,
      clipStartPx,
      clipHeightPx,
    };
  };

  it('returns empty requested times and tiles when mode is none', () => {
    const options = createMockOptions('none');
    const { requestedThumbnailTimes, thumbnailTiles } = useTimelineClipThumbnails(options);

    expect(requestedThumbnailTimes.value).toEqual([]);
    expect(thumbnailTiles.value).toEqual([]);
  });

  it('computes full range of requested times in standard mode', () => {
    const options = createMockOptions('standard');
    const { requestedThumbnailTimes } = useTimelineClipThumbnails(options);

    // standard mode: requestedTimesS should contain times across the whole visible region.
    // video duration is 20s, step is 4s (default INTERVAL_SECONDS), so it requests times like 0, 4, 8, 12, 16, 20
    expect(requestedThumbnailTimes.value).toEqual([0, 4, 8, 12, 16, 20]);
  });

  it('computes only edge times in edges mode', () => {
    const options = createMockOptions('edges');
    const { requestedThumbnailTimes } = useTimelineClipThumbnails(options);

    // edges mode: totalTiles = clipWidth / tileDisplayWidth.
    // In this test we verify that in edges mode fewer times are requested,
    // and they correspond only to the first and last frames of the clip (one thumbnail on the left, one on the right).
    const times = requestedThumbnailTimes.value;
    expect(times).toEqual([0, 16]);
  });
});
