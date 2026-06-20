import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileMarkerPropertiesDrawer from '~/components/timeline/MobileMarkerPropertiesDrawer.vue';

const updateMarkerMock = vi.fn();
const removeMarkerMock = vi.fn();

const mockTimelineStore = reactive({
  markers: [
    { id: 'marker-1', color: '#eab308', label: 'Intro' },
  ],
  updateMarker: updateMarkerMock,
  removeMarker: removeMarkerMock,
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

const globalOptions = {
  stubs: {
    MobilePropertiesDrawer: {
      props: ['isOpen', 'activeSnapPoint'],
      emits: ['close', 'update:activeSnapPoint'],
      template: '<div class="drawer"><slot name="toolbar" /><slot /></div>',
    },
    MobileDrawerToolbarButton: {
      props: ['icon'],
      emits: ['click'],
      template: '<button class="toolbar-button" :data-icon="icon" @click="$emit(\'click\')" />',
    },
    MarkerProperties: {
      props: ['markerId', 'isMobile'],
      template: '<div class="marker-properties">Properties</div>',
    },
  },
};

describe('MobileMarkerPropertiesDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the drawer and marker properties', async () => {
    const wrapper = await mountSuspended(MobileMarkerPropertiesDrawer, {
      props: { isOpen: true, markerId: 'marker-1' },
      global: globalOptions,
    });

    expect(wrapper.find('.drawer').exists()).toBe(true);
    expect(wrapper.find('.marker-properties').exists()).toBe(true);
  });

  it('renders the delete toolbar button', async () => {
    const wrapper = await mountSuspended(MobileMarkerPropertiesDrawer, {
      props: { isOpen: true, markerId: 'marker-1' },
      global: globalOptions,
    });

    expect(wrapper.find('[data-icon="i-heroicons-trash"]').exists()).toBe(true);
  });

  it('removes the marker and closes the drawer when delete is clicked', async () => {
    const wrapper = await mountSuspended(MobileMarkerPropertiesDrawer, {
      props: { isOpen: true, markerId: 'marker-1' },
      global: globalOptions,
    });

    await wrapper.find('[data-icon="i-heroicons-trash"]').trigger('click');
    expect(removeMarkerMock).toHaveBeenCalledWith('marker-1');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('updates the marker color when a color swatch is clicked', async () => {
    const wrapper = await mountSuspended(MobileMarkerPropertiesDrawer, {
      props: { isOpen: true, markerId: 'marker-1' },
      global: globalOptions,
    });

    const swatches = wrapper.findAll('.w-6');
    expect(swatches.length).toBeGreaterThan(0);
    await swatches[1]!.trigger('click');
    expect(updateMarkerMock).toHaveBeenCalledWith('marker-1', { color: expect.any(String) });
  });
});
