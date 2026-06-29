import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ClipMetadata from '~/components/timeline/ClipMetadata.vue';

describe('ClipMetadata', () => {
  const track = { kind: 'video' } as any;
  const item = {
    kind: 'clip',
    id: 'c1',
    timelineRange: { startUs: 0, durationUs: 1000000 },
  } as any;

  const timelineContextMock = {
    timelineDoc: ref({ tracks: [] }),
    fps: ref(30),
  } as any;

  it('renders missing media overlay', async () => {
    const component = await mountSuspended(ClipMetadata, {
      props: { item, track, isMediaMissing: true, clipWidthPx: 100 },
      global: {
        provide: {
          timelineContext: timelineContextMock,
        },
      },
    });

    expect(component.html()).toContain('bg-red-600');
  });

  it('renders muted icon', async () => {
    const mutedItem = {
      kind: 'clip',
      id: 'c1',
      audioMuted: true,
      timelineRange: { startUs: 0, durationUs: 1000000 },
    } as any;
    const component = await mountSuspended(ClipMetadata, {
      props: { item: mutedItem, track, clipWidthPx: 100 },
      global: {
        provide: {
          timelineContext: timelineContextMock,
        },
      },
    });

    expect(component.html()).toContain('bg-black');
  });

  it('hides muted icon if track itself is muted', async () => {
    const mutedItem = {
      kind: 'clip',
      id: 'c1',
      audioMuted: true,
      timelineRange: { startUs: 0, durationUs: 1000000 },
    } as any;
    const mutedTrack = { kind: 'video', audioMuted: true } as any;
    const component = await mountSuspended(ClipMetadata, {
      props: { item: mutedItem, track: mutedTrack, clipWidthPx: 100 },
      global: {
        provide: {
          timelineContext: timelineContextMock,
        },
      },
    });

    expect(component.html()).not.toContain('bg-black');
  });

  it('renders disabled icon', async () => {
    const disabledItem = {
      kind: 'clip',
      id: 'c1',
      disabled: true,
      timelineRange: { startUs: 0, durationUs: 1000000 },
    } as any;
    const component = await mountSuspended(ClipMetadata, {
      props: { item: disabledItem, track, clipWidthPx: 100 },
      global: {
        provide: {
          timelineContext: timelineContextMock,
        },
      },
    });

    expect(component.html()).toContain('bg-black');
  });

  it('prioritizes disabled icon over muted icon when both are true', async () => {
    const disabledAndMutedItem = {
      kind: 'clip',
      id: 'c1',
      disabled: true,
      audioMuted: true,
      timelineRange: { startUs: 0, durationUs: 1000000 },
    } as any;
    const component = await mountSuspended(ClipMetadata, {
      props: { item: disabledAndMutedItem, track, clipWidthPx: 100 },
      global: {
        provide: {
          timelineContext: timelineContextMock,
        },
      },
    });

    expect(component.html()).toContain('w-4 h-4');
    expect(component.html()).not.toContain('w-6 h-6');
  });

  it('renders free position warning when clip is not frame-aligned', async () => {
    // 12345 Us is not aligned on 30 FPS boundary (33333 Us per frame)
    const nonAlignedItem = {
      kind: 'clip',
      id: 'c1',
      timelineRange: { startUs: 12345, durationUs: 1000000 },
    } as any;

    const component = await mountSuspended(ClipMetadata, {
      props: { item: nonAlignedItem, track, clipWidthPx: 100 },
      global: {
        provide: {
          timelineContext: timelineContextMock,
        },
      },
    });

    // Contains the warning triangle icon wrapper with correct title
    expect(component.find('[title="fastcat.timeline.freePositionHint"]').exists()).toBe(true);
    expect(component.find('[style*="--z-clip-free-pos"]').exists()).toBe(true);
  });

  it('renders freeze frame indicator badge when freezeFrameSourceUs is present', async () => {
    const freezeFrameItem = {
      kind: 'clip',
      id: 'c1',
      freezeFrameSourceUs: 500000,
      timelineRange: { startUs: 0, durationUs: 1000000 },
    } as any;

    const component = await mountSuspended(ClipMetadata, {
      props: { item: freezeFrameItem, track, clipWidthPx: 100 },
      global: {
        provide: {
          timelineContext: timelineContextMock,
        },
      },
    });

    // Contains the pause circle icon wrapper with correct title
    expect(component.find('[title="fastcat.timeline.freezeFrameTitle"]').exists()).toBe(true);
  });
});
