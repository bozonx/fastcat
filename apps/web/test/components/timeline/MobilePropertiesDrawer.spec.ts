import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobilePropertiesDrawer from '~/components/timeline/MobilePropertiesDrawer.vue';

const width = ref(400);
const height = ref(800);

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual('@vueuse/core');
  return {
    ...actual,
    useWindowSize: () => ({ width, height }),
  };
});

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const globalOptions = {
  stubs: {
    MobileTimelineDrawer: {
      props: ['open', 'activeSnapPoint'],
      emits: ['update:open', 'update:activeSnapPoint'],
      template: '<div class="drawer"><slot name="toolbar" /><slot /></div>',
    },
    MobileDrawerToolbar: {
      props: ['orientation'],
      template: '<div class="toolbar" :data-orientation="orientation"><slot /></div>',
    },
  },
};

describe('MobilePropertiesDrawer', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    width.value = 400;
    height.value = 800;
  });

  it('renders the drawer and toolbar slot', async () => {
    const wrapper = await mountSuspended(MobilePropertiesDrawer, {
      props: { isOpen: true },
      slots: { toolbar: '<div class="toolbar-content">Toolbar</div>' },
      global: globalOptions,
    });

    expect(wrapper.find('.drawer').exists()).toBe(true);
    expect(wrapper.find('.toolbar-content').exists()).toBe(true);
  });

  it('uses horizontal toolbar in portrait mode', async () => {
    const wrapper = await mountSuspended(MobilePropertiesDrawer, {
      props: { isOpen: true },
      slots: { toolbar: '<div class="toolbar-content" />' },
      global: globalOptions,
    });

    expect(wrapper.find('.toolbar').attributes('data-orientation')).toBe('horizontal');
  });

  it('uses vertical toolbar in landscape mode', async () => {
    width.value = 800;
    height.value = 400;

    const wrapper = await mountSuspended(MobilePropertiesDrawer, {
      props: { isOpen: true },
      slots: { toolbar: '<div class="toolbar-content" />' },
      global: globalOptions,
    });

    expect(wrapper.find('.toolbar').attributes('data-orientation')).toBe('vertical');
  });
});
