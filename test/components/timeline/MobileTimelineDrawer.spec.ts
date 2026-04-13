import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { ref } from 'vue';
import MobileTimelineDrawer from '~/components/timeline/MobileTimelineDrawer.vue';

const mockWidth = ref(390);
const mockHeight = ref(844);

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual('@vueuse/core');

  return {
    ...(actual as object),
    useWindowSize: () => ({
      width: mockWidth,
      height: mockHeight,
    }),
  };
});

describe('MobileTimelineDrawer', () => {
  beforeEach(() => {
    mockWidth.value = 390;
    mockHeight.value = 844;
  });

  it('opens immediately in expanded mode without toolbar snap by default', async () => {
    const wrapper = await mountSuspended(MobileTimelineDrawer, {
      props: {
        open: true,
      },
      slots: {
        default: '<div class="drawer-body">Body</div>',
      },
      global: {
        stubs: {
          UiMobileDrawer: {
            name: 'UiMobileDrawer',
            props: [
              'open',
              'activeSnapPoint',
              'direction',
              'snapPoints',
              'modal',
              'overlay',
              'withHandle',
              'showClose',
              'ui',
            ],
            template: '<div class="ui-mobile-drawer-stub" />',
          },
        },
      },
    });

    const drawer = wrapper.findComponent({ name: 'UiMobileDrawer' });

    expect(drawer.props('snapPoints')).toEqual([0.92]);
    expect(wrapper.emitted('update:activeSnapPoint')?.at(-1)).toEqual([0.92]);
  });

  it('opens in toolbar mode when toolbar snap is enabled', async () => {
    const wrapper = await mountSuspended(MobileTimelineDrawer, {
      props: {
        open: true,
        withToolbarSnap: true,
      },
      slots: {
        default: '<div class="drawer-body">Body</div>',
      },
      global: {
        stubs: {
          UiMobileDrawer: {
            name: 'UiMobileDrawer',
            props: [
              'open',
              'activeSnapPoint',
              'direction',
              'snapPoints',
              'modal',
              'overlay',
              'withHandle',
              'showClose',
              'ui',
            ],
            template: '<div class="ui-mobile-drawer-stub" />',
          },
        },
      },
    });

    const drawer = wrapper.findComponent({ name: 'UiMobileDrawer' });

    expect(drawer.props('snapPoints')).toEqual(['116px', 0.92]);
    expect(wrapper.emitted('update:activeSnapPoint')?.at(-1)).toEqual(['116px']);
  });

  it('can open immediately in full mode when requested', async () => {
    const wrapper = await mountSuspended(MobileTimelineDrawer, {
      props: {
        open: true,
        withToolbarSnap: true,
        initialMode: 'full',
      },
      slots: {
        default: '<div class="drawer-body">Body</div>',
      },
      global: {
        stubs: {
          UiMobileDrawer: {
            name: 'UiMobileDrawer',
            props: [
              'open',
              'activeSnapPoint',
              'direction',
              'snapPoints',
              'modal',
              'overlay',
              'withHandle',
              'showClose',
              'ui',
            ],
            template: '<div class="ui-mobile-drawer-stub" />',
          },
        },
      },
    });

    expect(wrapper.emitted('update:activeSnapPoint')?.at(-1)).toEqual([0.92]);
  });

  it('always opens as a right drawer in landscape without snap points', async () => {
    mockWidth.value = 844;
    mockHeight.value = 390;

    const wrapper = await mountSuspended(MobileTimelineDrawer, {
      props: {
        open: true,
        withToolbarSnap: true,
      },
      slots: {
        default: '<div class="drawer-body">Body</div>',
      },
      global: {
        stubs: {
          UiMobileDrawer: {
            name: 'UiMobileDrawer',
            props: [
              'open',
              'activeSnapPoint',
              'direction',
              'snapPoints',
              'modal',
              'overlay',
              'withHandle',
              'showClose',
              'ui',
            ],
            template: '<div class="ui-mobile-drawer-stub" />',
          },
        },
      },
    });

    const drawer = wrapper.findComponent({ name: 'UiMobileDrawer' });

    expect(drawer.props('direction')).toBe('right');
    expect(drawer.props('snapPoints')).toBeUndefined();
    expect(wrapper.emitted('update:activeSnapPoint')).toBeFalsy();
  });
});
