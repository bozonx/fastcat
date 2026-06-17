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

  it('renders title and grid buttons', async () => {
    const wrapper = await mountSuspended(MobileTrimToolbar, {
      global: {
        stubs: {
          UButton: { template: '<button><slot /></button>' },
          UIcon: { template: '<span />' },
        },
      },
    });

    expect(wrapper.text()).toContain('fastcat.timeline.trimByPlayhead');
    expect(wrapper.text()).toContain('fastcat.timeline.leftTail');
    expect(wrapper.text()).toContain('fastcat.timeline.rightTail');
    expect(wrapper.text()).toContain('fastcat.timeline.trim');
    expect(wrapper.text()).toContain('fastcat.timeline.trimWithOffset');
    expect(wrapper.text()).toContain('fastcat.timeline.trimWithTimelineCut');
  });

  it('calls correct store methods when playhead trim buttons are clicked', async () => {
    const wrapper = await mountSuspended(MobileTrimToolbar, {
      global: {
        stubs: {
          UButton: { template: '<button><slot /></button>' },
          UIcon: { template: '<span />' },
        },
      },
    });

    const buttons = wrapper.findAll('button');
    // Grid buttons: 6 action buttons (2 cols x 3 rows)
    const gridButtons = wrapper.findAll('.grid-cols-2 button');
    expect(gridButtons.length).toBe(6);

    await gridButtons[0].trigger('click');
    expect(trimToPlayheadLeftNoRipple).toHaveBeenCalled();

    await gridButtons[1].trigger('click');
    expect(trimToPlayheadRightNoRipple).toHaveBeenCalled();

    await gridButtons[2].trigger('click');
    expect(rippleTrimLeft).toHaveBeenCalled();

    await gridButtons[3].trigger('click');
    expect(rippleTrimRight).toHaveBeenCalled();

    await gridButtons[4].trigger('click');
    expect(advancedRippleTrimLeft).toHaveBeenCalled();

    await gridButtons[5].trigger('click');
    expect(advancedRippleTrimRight).toHaveBeenCalled();
  });

  it('disables grid buttons when clip is locked', async () => {
    mockTimelineStore.timelineDoc!.tracks[0].items[0].locked = true;

    const wrapper = await mountSuspended(MobileTrimToolbar, {
      global: {
        stubs: {
          UButton: { template: '<button><slot /></button>' },
          UIcon: { template: '<span />' },
        },
      },
    });

    const gridButtons = wrapper.findAll('.grid-cols-2 button');
    for (const btn of gridButtons) {
      expect(btn.attributes('disabled')).toBeDefined();
    }
  });

  it('emits trim events for manual trim areas', async () => {
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
  });
});
