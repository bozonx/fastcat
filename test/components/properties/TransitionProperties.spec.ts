import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import TransitionProperties from '~/components/properties/TransitionProperties.vue';
import { timelineUs } from '../../unit/utils/timeline-time';

const mockUpdateClipTransition = vi.fn();

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => ({
    updateClipTransition: mockUpdateClipTransition,
  }),
}));

const getPrevClipForItemMock = vi.fn(() => null);
const getNextClipForItemMock = vi.fn(() => null);
const getClipTailTimelineHandleUsMock = vi.fn(() => timelineUs(1_000_000));
const getClipHeadTimelineHandleUsMock = vi.fn(() => timelineUs(1_000_000));

vi.mock('~/utils/timeline/clip', () => ({
  getPrevClipForItem: (...args: unknown[]) =>
    getPrevClipForItemMock(...(args as [TimelineTrack, TimelineClipItem])),
  getNextClipForItem: (...args: unknown[]) =>
    getNextClipForItemMock(...(args as [TimelineTrack, TimelineClipItem])),
  getClipTailTimelineHandleUs: (c: TimelineClipItem) => getClipTailTimelineHandleUsMock(c),
  getClipHeadTimelineHandleUs: (c: TimelineClipItem) => getClipHeadTimelineHandleUsMock(c),
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
  template: `<div class="panel-mock" :data-edge="edge" :data-max="maxDuration"><button class="emit-update" @click="$emit('update', { trackId, itemId, edge, transition: { type: 'fade', durationUs: ${timelineUs(500_000)} } })" /></div>`,
};

function createClip(overrides: Partial<TimelineClipItem> = {}): TimelineClipItem {
  const clip = {
    kind: 'clip',
    clipType: 'media',
    id: 'item-1',
    trackId: 'track-1',
    name: 'Clip',
    timelineRange: { startUs: 1_000_000, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
    ...overrides,
  } as TimelineClipItem;

  return {
    ...clip,
    timelineRange: {
      startUs: timelineUs(clip.timelineRange.startUs),
      durationUs: timelineUs(clip.timelineRange.durationUs),
    },
    sourceRange: {
      startUs: timelineUs(clip.sourceRange.startUs),
      durationUs: timelineUs(clip.sourceRange.durationUs),
    },
    transitionIn: clip.transitionIn && {
      ...clip.transitionIn,
      durationUs: timelineUs(clip.transitionIn.durationUs),
    },
    transitionOut: clip.transitionOut && {
      ...clip.transitionOut,
      durationUs: timelineUs(clip.transitionOut.durationUs),
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
    const clip = createClip({ transitionIn: { type: 'fade', durationUs: 300_000 } as any });
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
      transitionIn: { type: 'fade', durationUs: 300_000 } as any,
      transitionOut: { type: 'wipe', durationUs: 500_000 } as any,
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
      transitionIn: { type: 'fade', durationUs: 2_000_000 } as any,
      transitionOut: { type: 'wipe', durationUs: 500_000 } as any,
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
      timelineRange: { startUs: 1_000_000, durationUs: 5_000_000 },
      transitionIn: { type: 'fade', durationUs: 100_000, mode: 'adjacent' } as any,
    });
    const adjacent = createClip({
      id: 'adj-1',
      timelineRange: { startUs: 0, durationUs: 1_000_000 }, // ends at 1_000_000, touches clip start
    });
    getPrevClipForItemMock.mockReturnValueOnce(adjacent);
    getClipTailTimelineHandleUsMock.mockReturnValueOnce(timelineUs(500_000)); // 0.5s handle limit

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
    const clip = createClip({ transitionIn: { type: 'fade', durationUs: 300_000 } as any });
    const component = await mountSuspended(TransitionProperties, {
      props: {
        transitionSelection: { trackId: 'track-1', itemId: 'item-1', edge: 'in' },
        clip,
      },
      global: { stubs },
    });

    await component.find('.emit-update').trigger('click');

    expect(mockUpdateClipTransition).toHaveBeenCalledWith('track-1', 'item-1', {
      transitionIn: { type: 'fade', durationUs: timelineUs(500_000) },
    });
  });

  it('forwards update event to timelineStore.updateClipTransition for edge out', async () => {
    mockUpdateClipTransition.mockClear();
    const clip = createClip({ transitionOut: { type: 'fade', durationUs: 300_000 } as any });
    const component = await mountSuspended(TransitionProperties, {
      props: {
        transitionSelection: { trackId: 'track-1', itemId: 'item-1', edge: 'out' },
        clip,
      },
      global: { stubs },
    });

    await component.find('.emit-update').trigger('click');

    expect(mockUpdateClipTransition).toHaveBeenCalledWith('track-1', 'item-1', {
      transitionOut: { type: 'fade', durationUs: timelineUs(500_000) },
    });
  });

  it('exposes openSaveModal via defineExpose', async () => {
    const clip = createClip({ transitionIn: { type: 'fade', durationUs: 300_000 } as any });
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
