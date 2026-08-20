import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import TransitionProperties from '~/components/properties/TransitionProperties.vue';

const mockUpdateClipTransition = vi.fn();

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => ({
    updateClipTransition: mockUpdateClipTransition,
  }),
}));

const getPrevClipForItemMock = vi.fn(() => null);
const getNextClipForItemMock = vi.fn(() => null);
const getClipTailTimelineHandleUsMock = vi.fn(() => 254_016_000_000);
const getClipHeadTimelineHandleUsMock = vi.fn(() => 254_016_000_000);

vi.mock('~/utils/timeline/clip', () => ({
  getPrevClipForItem: (...args: unknown[]) =>
    getPrevClipForItemMock(...(args as [TimelineTrack, TimelineClipItem])),
  getNextClipForItem: (...args: unknown[]) =>
    getNextClipForItemMock(...(args as [TimelineTrack, TimelineClipItem])),
  getClipTailTimelineHandleTicks: (c: TimelineClipItem) => getClipTailTimelineHandleUsMock(c),
  getClipHeadTimelineHandleTicks: (c: TimelineClipItem) => getClipHeadTimelineHandleUsMock(c),
}));

// Stub the panel — we drive its update event to test handleTransitionUpdate.
const ClipTransitionPanelStub = {
  props: ['edge', 'trackId', 'itemId', 'track', 'clip', 'transition', 'maxDuration', 'hideActions'],
  emits: ['update'],
  expose: ['openSaveModal'],
  setup(_: unknown, { expose }: { expose: (v: unknown) => void }) {
    expose({ openSaveModal: vi.fn() });
    return { exposedOpenSaveModal: vi.fn() };
  },
  template: `<div class="panel-mock" :data-edge="edge" :data-max="maxDuration"><button class="emit-update" @click="$emit('update', { trackId, itemId, edge, transition: { type: 'fade', durationTicks: ${127_008_000_000} } })" /></div>`,
};

function createClip(overrides: Partial<TimelineClipItem> = {}): TimelineClipItem {
  const clip = {
    kind: 'clip',
    clipType: 'media',
    id: 'item-1',
    trackId: 'track-1',
    name: 'Clip',
    timelineRange: { startTicks: 1_000_000, durationTicks: 5_000_000 },
    sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
    ...overrides,
  } as TimelineClipItem;

  return {
    ...clip,
    timelineRange: {
      startTicks: clip.timelineRange.startTicks * 254_016,
      durationTicks: clip.timelineRange.durationTicks * 254_016,
    },
    sourceRange: {
      startTicks: clip.sourceRange.startTicks * 254_016,
      durationTicks: clip.sourceRange.durationTicks * 254_016,
    },
    transitionIn: clip.transitionIn && {
      ...clip.transitionIn,
      durationTicks: clip.transitionIn.durationTicks * 254_016,
    },
    transitionOut: clip.transitionOut && {
      ...clip.transitionOut,
      durationTicks: clip.transitionOut.durationTicks * 254_016,
    },
  } as TimelineClipItem;
}

function createTrack(items: TimelineClipItem[] = []): TimelineTrack {
  return { id: 'track-1', kind: 'video', items } as TimelineTrack;
}

describe('TransitionProperties', () => {
  const stubs = { ClipTransitionPanel: ClipTransitionPanelStub };

  it('does not render panel when clip is missing', async () => {
    const component = await mountSuspended(TransitionProperties, {
      props: { transitionSelection: { trackId: 'track-1', itemId: 'item-1', edge: 'in' } },
      global: { stubs },
    });

    expect(component.find('.panel-mock').exists()).toBe(false);
  });

  it('renders panel with transitionIn value for edge in', async () => {
    const clip = createClip({ transitionIn: { type: 'fade', durationTicks: 300_000 } as any });
    const component = await mountSuspended(TransitionProperties, {
      props: {
        transitionSelection: { trackId: 'track-1', itemId: 'item-1', edge: 'in' },
        clip,
      },
      global: { stubs },
    });

    expect(component.find('.panel-mock').exists()).toBe(true);
  });

  it('computes basic maxDuration from clip duration minus opposite transition (edge in)', async () => {
    const clip = createClip({
      transitionIn: { type: 'fade', durationTicks: 300_000 } as any,
      transitionOut: { type: 'wipe', durationTicks: 500_000 } as any,
    });
    const component = await mountSuspended(TransitionProperties, {
      props: {
        transitionSelection: { trackId: 'track-1', itemId: 'item-1', edge: 'in' },
        clip,
      },
      global: { stubs },
    });

    // 5_000_000 - 500_000 = 4_500_000 us = 4.5s
    expect(component.find('.panel-mock').attributes('data-max')).toBe('4.5');
  });

  it('computes maxDuration for edge out subtracting transitionIn', async () => {
    const clip = createClip({
      transitionIn: { type: 'fade', durationTicks: 2_000_000 } as any,
      transitionOut: { type: 'wipe', durationTicks: 500_000 } as any,
    });
    const component = await mountSuspended(TransitionProperties, {
      props: {
        transitionSelection: { trackId: 'track-1', itemId: 'item-1', edge: 'out' },
        clip,
      },
      global: { stubs },
    });

    // 5_000_000 - 2_000_000 = 3_000_000 us = 3s
    expect(component.find('.panel-mock').attributes('data-max')).toBe('3');
  });

  it('limits maxDuration to adjacent clip handle when mode is adjacent and prev clip is close', async () => {
    const clip = createClip({
      timelineRange: { startTicks: 1_000_000, durationTicks: 5_000_000 },
      transitionIn: { type: 'fade', durationTicks: 100_000, mode: 'adjacent' } as any,
    });
    const adjacent = createClip({
      id: 'adj-1',
      timelineRange: { startTicks: 0, durationTicks: 1_000_000 }, // ends at 1_000_000, touches clip start
    });
    getPrevClipForItemMock.mockReturnValueOnce(adjacent);
    getClipTailTimelineHandleUsMock.mockReturnValueOnce(127_008_000_000); // 0.5s handle limit

    const component = await mountSuspended(TransitionProperties, {
      props: {
        transitionSelection: { trackId: 'track-1', itemId: 'item-1', edge: 'in' },
        clip,
        track: createTrack([adjacent, clip]),
      },
      global: { stubs },
    });

    // min(5_000_000, 500_000) = 500_000 us = 0.5s
    expect(component.find('.panel-mock').attributes('data-max')).toBe('0.5');
    expect(getPrevClipForItemMock).toHaveBeenCalled();
  });

  it('forwards update event to timelineStore.updateClipTransition for edge in', async () => {
    mockUpdateClipTransition.mockClear();
    const clip = createClip({ transitionIn: { type: 'fade', durationTicks: 300_000 } as any });
    const component = await mountSuspended(TransitionProperties, {
      props: {
        transitionSelection: { trackId: 'track-1', itemId: 'item-1', edge: 'in' },
        clip,
      },
      global: { stubs },
    });

    await component.find('.emit-update').trigger('click');

    expect(mockUpdateClipTransition).toHaveBeenCalledWith('track-1', 'item-1', {
      transitionIn: { type: 'fade', durationTicks: 127_008_000_000 },
    });
  });

  it('forwards update event to timelineStore.updateClipTransition for edge out', async () => {
    mockUpdateClipTransition.mockClear();
    const clip = createClip({ transitionOut: { type: 'fade', durationTicks: 300_000 } as any });
    const component = await mountSuspended(TransitionProperties, {
      props: {
        transitionSelection: { trackId: 'track-1', itemId: 'item-1', edge: 'out' },
        clip,
      },
      global: { stubs },
    });

    await component.find('.emit-update').trigger('click');

    expect(mockUpdateClipTransition).toHaveBeenCalledWith('track-1', 'item-1', {
      transitionOut: { type: 'fade', durationTicks: 127_008_000_000 },
    });
  });

  it('exposes openSaveModal via defineExpose', async () => {
    const clip = createClip({ transitionIn: { type: 'fade', durationTicks: 300_000 } as any });
    const component = await mountSuspended(TransitionProperties, {
      props: {
        transitionSelection: { trackId: 'track-1', itemId: 'item-1', edge: 'in' },
        clip,
      },
      global: { stubs },
    });

    // Should not throw when calling exposed method
    expect(() => {
      (component.vm as any).openSaveModal?.();
    }).not.toThrow();
  });
});
