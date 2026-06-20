import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileTransitionPropertiesDrawer from '~/components/timeline/MobileTransitionPropertiesDrawer.vue';

const updateClipTransitionMock = vi.fn();

const mockTimelineStore = reactive({
  updateClipTransition: updateClipTransitionMock,
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

const clip = { id: 'clip-1', transitionIn: { type: 'fade' }, transitionOut: null } as any;
const track = { id: 'track-1', kind: 'video' } as any;

const globalOptions = {
  stubs: {
    MobilePropertiesDrawer: {
      props: ['isOpen', 'activeSnapPoint'],
      emits: ['close', 'update:activeSnapPoint'],
      template: '<div class="drawer"><slot name="toolbar" /><slot /></div>',
    },
    MobileDrawerToolbarButton: {
      props: ['icon', 'label'],
      emits: ['click'],
      template: '<button class="toolbar-button" :data-icon="icon" :data-label="label" @click="$emit(\'click\')" />',
    },
    TransitionProperties: {
      props: ['transitionSelection', 'clip', 'track', 'hideActions'],
      template: '<div class="transition-properties">Properties</div>',
    },
  },
};

describe('MobileTransitionPropertiesDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the drawer and properties', async () => {
    const wrapper = await mountSuspended(MobileTransitionPropertiesDrawer, {
      props: {
        isOpen: true,
        transitionSelection: { trackId: 'track-1', itemId: 'clip-1', edge: 'in' },
        clip,
        track,
      },
      global: globalOptions,
    });

    expect(wrapper.find('.drawer').exists()).toBe(true);
    expect(wrapper.find('.transition-properties').exists()).toBe(true);
  });

  it('deletes the in transition and closes the drawer', async () => {
    const wrapper = await mountSuspended(MobileTransitionPropertiesDrawer, {
      props: {
        isOpen: true,
        transitionSelection: { trackId: 'track-1', itemId: 'clip-1', edge: 'in' },
        clip,
        track,
      },
      global: globalOptions,
    });

    await wrapper.find('[data-icon="i-heroicons-trash"]').trigger('click');
    expect(updateClipTransitionMock).toHaveBeenCalledWith('track-1', 'clip-1', { transitionIn: null });
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('deletes the out transition and closes the drawer', async () => {
    const wrapper = await mountSuspended(MobileTransitionPropertiesDrawer, {
      props: {
        isOpen: true,
        transitionSelection: { trackId: 'track-1', itemId: 'clip-1', edge: 'out' },
        clip,
        track,
      },
      global: globalOptions,
    });

    await wrapper.find('[data-icon="i-heroicons-trash"]').trigger('click');
    expect(updateClipTransitionMock).toHaveBeenCalledWith('track-1', 'clip-1', { transitionOut: null });
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
