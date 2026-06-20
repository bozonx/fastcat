import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { ref, nextTick } from 'vue';
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

const uiMobileDrawerStub = {
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
};

const uiMobileDrawerStubWithSlots = {
  ...uiMobileDrawerStub,
  template:
    '<div class="ui-mobile-drawer-stub"><slot name="toolbar" /><slot name="header" /><slot /></div>',
};

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
          UiMobileDrawer: uiMobileDrawerStub,
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
          UiMobileDrawer: uiMobileDrawerStub,
        },
      },
    });

    const drawer = wrapper.findComponent({ name: 'UiMobileDrawer' });

    expect(drawer.props('snapPoints')).toEqual(['94px', 0.92]);
    expect(wrapper.emitted('update:activeSnapPoint')?.at(-1)).toEqual(['94px']);
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
          UiMobileDrawer: uiMobileDrawerStub,
        },
      },
    });

    expect(wrapper.emitted('update:activeSnapPoint')?.at(-1)).toEqual([0.92]);
  });

  it('opens as a right drawer with vertical toolbar snaps in landscape', async () => {
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
          UiMobileDrawer: uiMobileDrawerStub,
        },
      },
    });

    const drawer = wrapper.findComponent({ name: 'UiMobileDrawer' });

    // Landscape: width-based snaps. Rail at toolbarSnapWidth, full at 60vw (844*0.60).
    expect(drawer.props('direction')).toBe('right');
    expect(drawer.props('snapPoints')).toEqual(['84px', '506px']);
    // Starts collapsed to the rail (first snap), like the portrait toolbar mode.
    expect(wrapper.emitted('update:activeSnapPoint')?.at(-1)).toEqual(['84px']);
  });

  it('omits snap points for a landscape side drawer without a toolbar', async () => {
    mockWidth.value = 844;
    mockHeight.value = 390;

    const wrapper = await mountSuspended(MobileTimelineDrawer, {
      props: {
        open: true,
      },
      slots: {
        default: '<div class="drawer-body">Body</div>',
      },
      global: {
        stubs: {
          UiMobileDrawer: uiMobileDrawerStub,
        },
      },
    });

    const drawer = wrapper.findComponent({ name: 'UiMobileDrawer' });

    expect(drawer.props('direction')).toBe('right');
    expect(drawer.props('snapPoints')).toBeUndefined();
    expect(wrapper.emitted('update:activeSnapPoint')).toBeFalsy();
  });

  it('uses custom toolbarSnapHeight', async () => {
    const wrapper = await mountSuspended(MobileTimelineDrawer, {
      props: {
        open: true,
        withToolbarSnap: true,
        toolbarSnapHeight: '200px',
      },
      slots: {
        default: '<div class="drawer-body">Body</div>',
      },
      global: {
        stubs: {
          UiMobileDrawer: uiMobileDrawerStub,
        },
      },
    });

    const drawer = wrapper.findComponent({ name: 'UiMobileDrawer' });
    expect(drawer.props('snapPoints')).toEqual(['200px', 0.92]);
  });

  it('closes entirely when activeSnapPoint transitions from full to toolbar', async () => {
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
          UiMobileDrawer: uiMobileDrawerStub,
        },
      },
    });

    await wrapper.setProps({ activeSnapPoint: '94px' });
    await nextTick();

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
  });

  it('does not auto-close when opening while the shared snap point still holds the full value', async () => {
    // Simulates long-press opening the multi-selection drawer right after another
    // drawer was shown at full snap: the shared activeSnapPoint model still holds
    // 0.92, so opening assigns the toolbar snap and the net 0.92 -> toolbar change
    // must NOT be mistaken for a user swipe-to-close.
    const wrapper = await mountSuspended(MobileTimelineDrawer, {
      props: {
        open: false,
        withToolbarSnap: true,
        activeSnapPoint: 0.92,
      },
      slots: {
        default: '<div class="drawer-body">Body</div>',
      },
      global: {
        stubs: {
          UiMobileDrawer: uiMobileDrawerStub,
        },
      },
    });

    await wrapper.setProps({ open: true });
    await nextTick();
    await nextTick();

    expect(wrapper.emitted('update:open')?.some(([v]) => v === false)).toBeFalsy();
    expect(wrapper.emitted('update:activeSnapPoint')?.at(-1)).toEqual(['94px']);
  });

  it('passes toolbar slot through to UiMobileDrawer', async () => {
    const wrapper = await mountSuspended(MobileTimelineDrawer, {
      props: {
        open: true,
        withToolbarSnap: true,
      },
      slots: {
        default: '<div class="drawer-body">Body</div>',
        toolbar: '<div class="toolbar-slot">Toolbar</div>',
      },
      global: {
        stubs: {
          UiMobileDrawer: uiMobileDrawerStubWithSlots,
        },
      },
    });

    expect(wrapper.find('.toolbar-slot').exists()).toBe(true);
  });

  it('passes header slot through to UiMobileDrawer', async () => {
    const wrapper = await mountSuspended(MobileTimelineDrawer, {
      props: {
        open: true,
      },
      slots: {
        default: '<div class="drawer-body">Body</div>',
        header: '<div class="header-slot">Header</div>',
      },
      global: {
        stubs: {
          UiMobileDrawer: uiMobileDrawerStubWithSlots,
        },
      },
    });

    expect(wrapper.find('.header-slot').exists()).toBe(true);
  });

  it('passes showClose prop through to UiMobileDrawer', async () => {
    const wrapper = await mountSuspended(MobileTimelineDrawer, {
      props: {
        open: true,
        showClose: true,
      },
      slots: {
        default: '<div class="drawer-body">Body</div>',
      },
      global: {
        stubs: {
          UiMobileDrawer: uiMobileDrawerStub,
        },
      },
    });

    const drawer = wrapper.findComponent({ name: 'UiMobileDrawer' });
    expect(drawer.props('showClose')).toBe(true);
  });

  it('resets to initial snap point on re-open', async () => {
    const wrapper = await mountSuspended(MobileTimelineDrawer, {
      props: {
        open: true,
        withToolbarSnap: true,
        activeSnapPoint: 0.92,
      },
      slots: {
        default: '<div class="drawer-body">Body</div>',
      },
      global: {
        stubs: {
          UiMobileDrawer: uiMobileDrawerStub,
        },
      },
    });

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });

    expect(wrapper.emitted('update:activeSnapPoint')?.at(-1)).toEqual(['94px']);
  });
});
