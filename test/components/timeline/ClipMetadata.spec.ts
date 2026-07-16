import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ClipMetadata from '~/components/timeline/ClipMetadata.vue';

describe('ClipMetadata', () => {
  const track = { kind: 'video' } as any;
  const item = {
    kind: 'clip',
    id: 'c1',
    timelineRange: { startTicks: 0, durationTicks: 1000000 },
  } as any;

  const timelineContextMock = {
    timelineDoc: ref({ tracks: [] }),
    fps: ref(30),
    zoom: ref(1),
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
      timelineRange: { startTicks: 0, durationTicks: 1000000 },
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
      timelineRange: { startTicks: 0, durationTicks: 1000000 },
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
      timelineRange: { startTicks: 0, durationTicks: 1000000 },
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

  it('renders disabled and muted icons when both are true', async () => {
    const disabledAndMutedItem = {
      kind: 'clip',
      id: 'c1',
      disabled: true,
      audioMuted: true,
      timelineRange: { startTicks: 0, durationTicks: 1000000 },
    } as any;
    const component = await mountSuspended(ClipMetadata, {
      props: { item: disabledAndMutedItem, track, clipWidthPx: 100 },
      global: {
        provide: {
          timelineContext: timelineContextMock,
        },
        stubs: {
          UIcon: { props: ['name'], template: '<span class="icon-mock" :data-icon="name" />' },
        },
      },
    });

    const icons = component.findAll('.icon-mock');
    expect(icons).toHaveLength(2);
    expect(icons[0]?.attributes('data-icon')).toBe('i-heroicons-eye-slash');
    expect(icons[1]?.attributes('data-icon')).toBe('i-heroicons-speaker-x-mark');
  });

  it('does not render free position warning when clip is not frame-aligned', async () => {
    // 12345 Us is not aligned on 30 FPS boundary (33333 Us per frame)
    const nonAlignedItem = {
      kind: 'clip',
      id: 'c1',
      timelineRange: { startTicks: 12345, durationTicks: 1000000 },
    } as any;

    const component = await mountSuspended(ClipMetadata, {
      props: { item: nonAlignedItem, track, clipWidthPx: 100 },
      global: {
        provide: {
          timelineContext: timelineContextMock,
        },
      },
    });

    // Warning triangle icon wrapper with correct title should not exist
    expect(component.find('[title="fastcat.timeline.freePositionHint"]').exists()).toBe(false);
  });

  it('does not render freeze frame indicator badge when freezeFrameSourceTicks is present', async () => {
    const freezeFrameItem = {
      kind: 'clip',
      id: 'c1',
      freezeFrameSourceTicks: 500000,
      timelineRange: { startTicks: 0, durationTicks: 1000000 },
    } as any;

    const component = await mountSuspended(ClipMetadata, {
      props: { item: freezeFrameItem, track, clipWidthPx: 100 },
      global: {
        provide: {
          timelineContext: timelineContextMock,
        },
      },
    });

    // Freeze frame pause indicator should not be rendered
    expect(component.find('[title="fastcat.timeline.freezeFrameTitle"]').exists()).toBe(false);
  });
});
