import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileTrimToolbar from '~/components/timeline/MobileTrimToolbar.vue';

const trimToPlayheadLeftNoRipple = vi.fn();
const trimToPlayheadRightNoRipple = vi.fn();
const rippleTrimLeft = vi.fn();
const rippleTrimRight = vi.fn();
const advancedRippleTrimLeft = vi.fn();
const advancedRippleTrimRight = vi.fn();

const mockTimelineStore = reactive({
  timelineDoc: {
    tracks: [
      {
        id: 'track-1',
        kind: 'video',
        locked: false,
        items: [
          {
            id: 'clip-1',
            kind: 'clip',
            locked: false,
            name: 'Test Clip',
            timelineRange: { startTicks: 1000000, durationTicks: 5000000 },
          },
        ],
      },
    ],
  },
  trimToPlayheadLeftNoRipple,
  trimToPlayheadRightNoRipple,
  rippleTrimLeft,
  rippleTrimRight,
  advancedRippleTrimLeft,
  advancedRippleTrimRight,
});

const mockSelectionStore = reactive({
  selectedEntity: {
    source: 'timeline',
    kind: 'clip',
    itemId: 'clip-1',
    trackId: 'track-1',
  },
});

function dispatchWindowTouch(
  type: 'touchmove' | 'touchend',
  point: { clientX: number; clientY: number; identifier?: number },
) {
  const event = new Event(type, { cancelable: true });
  const touch = { ...point, identifier: point.identifier ?? 1 } as Touch;
  Object.defineProperties(event, {
    touches: { value: type === 'touchmove' ? [touch] : [] },
    changedTouches: { value: type === 'touchend' ? [touch] : [] },
  });
  window.dispatchEvent(event);
}

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => mockSelectionStore,
}));

describe('MobileTrimToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.timelineDoc!.tracks[0].locked = false;
    mockTimelineStore.timelineDoc!.tracks[0].items[0].locked = false;
    mockSelectionStore.selectedEntity = {
      source: 'timeline',
      kind: 'clip',
      itemId: 'clip-1',
      trackId: 'track-1',
    };
  });

  it('renders manual trim title without clip name', async () => {
    const wrapper = await mountSuspended(MobileTrimToolbar, {
      global: {
        stubs: {
          UButton: { template: '<button><slot /></button>' },
          UIcon: { template: '<span />' },
        },
      },
    });

    expect(wrapper.text()).toContain('fastcat.timeline.manualTrim');
    expect(wrapper.text()).toContain('fastcat.timeline.trimStart');
    expect(wrapper.text()).toContain('fastcat.timeline.trimEnd');
    expect(wrapper.text()).not.toContain('Test Clip');
  });

  it('emits trim-start events for manual trim areas', async () => {
    const wrapper = await mountSuspended(MobileTrimToolbar, {
      global: {
        stubs: {
          UButton: { template: '<button><slot /></button>' },
          UIcon: { template: '<span />' },
        },
      },
    });

    const manualAreas = wrapper.findAll('.touch-none');
    expect(manualAreas.length).toBe(2);

    await manualAreas[0].trigger('touchstart', {
      touches: [{ clientX: 100, clientY: 200 }],
    });
    expect(wrapper.emitted('trim-start')).toBeTruthy();
    expect(wrapper.emitted('trim-start')![0][0]).toMatchObject({
      edge: 'start',
      clientX: 100,
      clientY: 200,
    });

    await manualAreas[1].trigger('touchstart', {
      touches: [{ clientX: 300, clientY: 200 }],
    });
    expect(wrapper.emitted('trim-start')![1][0]).toMatchObject({
      edge: 'end',
      clientX: 300,
      clientY: 200,
    });

    dispatchWindowTouch('touchend', { clientX: 300, clientY: 200 });
  });

  it('keeps tracking a trim swipe after it leaves the toolbar area', async () => {
    const wrapper = await mountSuspended(MobileTrimToolbar, {
      global: {
        stubs: {
          UButton: { template: '<button><slot /></button>' },
          UIcon: { template: '<span />' },
        },
      },
    });

    const startArea = wrapper.findAll('.touch-none')[0]!;
    await startArea.trigger('touchstart', {
      touches: [{ clientX: 100, clientY: 700, identifier: 1 }],
    });

    dispatchWindowTouch('touchmove', { clientX: 5, clientY: 100, identifier: 1 });
    dispatchWindowTouch('touchend', { clientX: 5, clientY: 100, identifier: 1 });

    expect(wrapper.emitted('trim-move')?.[0][0]).toMatchObject({ clientX: 5, clientY: 100 });
    expect(wrapper.emitted('trim-end')?.[0][0]).toMatchObject({ clientX: 5, clientY: 100 });
  });

  it('does not leak toolbar pointer events into the timeline drag session', async () => {
    const wrapper = await mountSuspended(MobileTrimToolbar, {
      global: {
        stubs: {
          UButton: { template: '<button><slot /></button>' },
          UIcon: { template: '<span />' },
        },
      },
    });
    const onWindowPointer = vi.fn();
    window.addEventListener('pointermove', onWindowPointer);
    window.addEventListener('pointerup', onWindowPointer);
    window.addEventListener('pointercancel', onWindowPointer);

    try {
      const trimArea = wrapper.findAll('.touch-none')[0]!;
      for (const type of ['pointermove', 'pointerup', 'pointercancel'] as const) {
        trimArea.element.dispatchEvent(
          new PointerEvent(type, { bubbles: true, clientX: 100, clientY: 200 }),
        );
      }

      expect(onWindowPointer).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('pointermove', onWindowPointer);
      window.removeEventListener('pointerup', onWindowPointer);
      window.removeEventListener('pointercancel', onWindowPointer);
    }
  });

  it('emits back and close events', async () => {
    const wrapper = await mountSuspended(MobileTrimToolbar, {
      global: {
        stubs: {
          UButton: { template: '<button><slot /></button>' },
          UIcon: { template: '<span />' },
        },
      },
    });

    const buttons = wrapper.findAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    await buttons[0].trigger('click');
    expect(wrapper.emitted('back')).toBeTruthy();

    await buttons[1].trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });
});
