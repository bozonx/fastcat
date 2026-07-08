import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { ref } from 'vue';
import type { TimelineClipItem } from '~/timeline/types';
import TimelineClipThumbnails from '~/components/timeline/TimelineClipThumbnails.vue';

const imageUrlRef = ref<string | null>(null);
const isImageRef = ref(false);
const thumbnailTilesRef = ref<Array<{ key: string; url: string; leftPx: number; widthPx: number }>>(
  [],
);
const trimOffsetPxRef = ref(0);

vi.mock('~/composables/timeline/useTimelineClipThumbnails', () => ({
  useTimelineClipThumbnails: () => ({
    imageUrl: imageUrlRef,
    isImage: isImageRef,
    thumbnailTiles: thumbnailTilesRef,
    trimOffsetPx: trimOffsetPxRef,
  }),
}));

vi.mock('@vueuse/core', () => ({
  useResizeObserver: () => {},
}));

function createClip(): TimelineClipItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Clip',
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
  } as TimelineClipItem;
}

function mountThumbnails(props: Partial<any> = {}) {
  return mountSuspended(TimelineClipThumbnails, {
    props: {
      item: createClip(),
      width: 200,
      scrollLeft: 0,
      viewportWidth: 800,
      clipStartPx: 0,
      ...props,
    },
  });
}

describe('TimelineClipThumbnails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageUrlRef.value = null;
    isImageRef.value = false;
    thumbnailTilesRef.value = [];
    trimOffsetPxRef.value = 0;
  });

  it('renders video thumbnail tiles when not image and tiles present', async () => {
    thumbnailTilesRef.value = [
      { key: 'k1', url: '/thumb1.jpg', leftPx: 0, widthPx: 100 },
      { key: 'k2', url: '/thumb2.jpg', leftPx: 100, widthPx: 100 },
    ];
    const component = await mountThumbnails();

    const imgs = component.findAll('img');
    expect(imgs.length).toBe(2);
    expect(imgs[0]!.attributes('src')).toBe('/thumb1.jpg');
  });

  it('does not render video strip when no tiles', async () => {
    const component = await mountThumbnails();
    expect(component.findAll('img').length).toBe(0);
  });

  it('renders image preview when isImage and imageUrl present', async () => {
    isImageRef.value = true;
    imageUrlRef.value = '/image.jpg';
    const component = await mountThumbnails();

    const imgs = component.findAll('img');
    expect(imgs.length).toBe(1);
    expect(imgs[0]!.attributes('src')).toBe('/image.jpg');
  });

  it('does not render image preview when isImage but no imageUrl', async () => {
    isImageRef.value = true;
    imageUrlRef.value = null;
    const component = await mountThumbnails();

    expect(component.findAll('img').length).toBe(0);
  });

  it('applies trimOffset to strip width', async () => {
    thumbnailTilesRef.value = [{ key: 'k1', url: '/t.jpg', leftPx: 0, widthPx: 100 }];
    trimOffsetPxRef.value = 20;
    const component = await mountThumbnails({ width: 200 });

    const strip = component.find('.absolute.inset-y-0');
    expect(strip.exists()).toBe(true);
    // width = props.width (200) + trimOffset (20) = 220
    expect(strip.attributes('style')).toContain('width: 220px');
  });
});
