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
            timelineRange: { startUs: 1000000, durationUs: 5000000 },
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
