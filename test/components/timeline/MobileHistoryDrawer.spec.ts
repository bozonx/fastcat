import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileHistoryDrawer from '~/components/timeline/MobileHistoryDrawer.vue';

const globalOptions = {
  stubs: {
    UiMobileDrawer: {
      props: ['open'],
      emits: ['update:open'],
      template: '<div class="drawer"><slot /></div>',
    },
    ProjectHistory: {
      props: {
        mobile: Boolean,
      },
      emits: ['action-selected'],
      template: '<div class="project-history" @click="$emit(\'action-selected\')">History</div>',
    },
  },
};

describe('MobileHistoryDrawer', () => {
  it('renders the drawer when open', async () => {
    const wrapper = await mountSuspended(MobileHistoryDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    expect(wrapper.find('.drawer').exists()).toBe(true);
    expect(wrapper.find('.project-history').exists()).toBe(true);
  });

  it('passes the mobile prop to ProjectHistory', async () => {
    const wrapper = await mountSuspended(MobileHistoryDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const history = wrapper.findComponent(globalOptions.stubs.ProjectHistory);
    expect(history.props('mobile')).toBe(true);
  });

});
