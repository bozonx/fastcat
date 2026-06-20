import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileMarkersDrawer from '~/components/timeline/MobileMarkersDrawer.vue';

const globalOptions = {
  stubs: {
    UiMobileDrawer: {
      props: ['open'],
      emits: ['update:open'],
      template: '<div class="drawer"><slot /></div>',
    },
    ProjectMarkers: {
      props: {
        compact: Boolean,
        colorFilterOrientation: String,
      },
      emits: ['marker-click'],
      template: '<div class="project-markers">Markers</div>',
    },
  },
};

describe('MobileMarkersDrawer', () => {
  it('renders the drawer when open', async () => {
    const wrapper = await mountSuspended(MobileMarkersDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    expect(wrapper.find('.drawer').exists()).toBe(true);
    expect(wrapper.find('.project-markers').exists()).toBe(true);
  });

  it('passes compact mode and orientation to ProjectMarkers', async () => {
    const wrapper = await mountSuspended(MobileMarkersDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const markers = wrapper.findComponent(globalOptions.stubs.ProjectMarkers);
    expect(markers.props('compact')).toBe(true);
    expect(['horizontal', 'vertical']).toContain(markers.props('colorFilterOrientation'));
  });

  it('emits close when a marker is clicked', async () => {
    const wrapper = await mountSuspended(MobileMarkersDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const markers = wrapper.findComponent(globalOptions.stubs.ProjectMarkers);
    await markers.vm.$emit('marker-click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
