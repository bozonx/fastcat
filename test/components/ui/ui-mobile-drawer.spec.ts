import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { ref } from 'vue';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';

const drawerStub = {
  name: 'UDrawer',
  props: [
    'open',
    'direction',
    'title',
    'description',
    'snapPoints',
    'activeSnapPoint',
    'dismissible',
    'shouldScaleBackground',
    'modal',
    'overlay',
    'handle',
    'handleOnly',
    'ui',
  ],
  emits: ['update:open', 'update:active-snap-point'],
  template: '<div class="udrawer-stub"><slot name="content" /></div>',
};

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

describe('UiMobileDrawer', () => {
  beforeEach(() => {
    mockWidth.value = 390;
    mockHeight.value = 844;
  });

  it('expands to the last snap point when tapping the handle in toolbar mode', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: {
        open: true,
        snapPoints: ['116px', 0.92],
        activeSnapPoint: '116px',
        direction: 'bottom',
      },
      slots: {
        toolbar: '<div class="toolbar-slot">Toolbar</div>',
        default: '<div class="body-slot">Body</div>',
      },
      global: {
        stubs: {
          UDrawer: drawerStub,
        },
      },
    });

    const handle = wrapper.find('.group');
    expect(handle.exists()).toBe(true);

    await handle.trigger('click');

    expect(wrapper.emitted('update:activeSnapPoint')).toBeTruthy();
    expect(wrapper.emitted('update:activeSnapPoint')?.at(-1)).toEqual([0.92]);
    expect(wrapper.emitted('update:open')).toBeFalsy();
  });

  it('closes when tapping the handle in expanded mode', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: {
        open: true,
        snapPoints: ['116px', 0.92],
        activeSnapPoint: 0.92,
        direction: 'bottom',
      },
      slots: {
        toolbar: '<div class="toolbar-slot">Toolbar</div>',
        default: '<div class="body-slot">Body</div>',
      },
      global: {
        stubs: {
          UDrawer: drawerStub,
        },
      },
    });

    const handle = wrapper.find('.group');
    expect(handle.exists()).toBe(true);

    await handle.trigger('click');

    expect(wrapper.emitted('update:open')).toBeTruthy();
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
    expect(wrapper.emitted('update:activeSnapPoint')?.at(-1)).toEqual([null]);
  });

  it('closes from handle tap without snap points when the drawer is already open', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: {
        open: true,
        direction: 'bottom',
      },
      slots: {
        default: '<div class="body-slot">Body</div>',
      },
      global: {
        stubs: {
          UDrawer: drawerStub,
        },
      },
    });

    const handle = wrapper.find('.group');
    expect(handle.exists()).toBe(true);

    await handle.trigger('click');

    expect(wrapper.emitted('update:open')).toBeTruthy();
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
    expect(wrapper.emitted('update:activeSnapPoint')).toBeFalsy();
  });

  it('renders toolbar content for horizontal scrolling scenarios', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: {
        open: true,
        snapPoints: ['116px', 0.92],
        activeSnapPoint: 0.92,
        direction: 'bottom',
      },
      slots: {
        toolbar:
          '<div class="toolbar-slot overflow-x-auto whitespace-nowrap"><div style="width: 1200px">Toolbar</div></div>',
        default: '<div class="body-slot">Body</div>',
      },
      global: {
        stubs: {
          UDrawer: drawerStub,
        },
      },
    });

    expect(wrapper.find('.toolbar-slot').exists()).toBe(true);
    expect(wrapper.find('.overflow-x-auto').exists()).toBe(true);
    expect(wrapper.emitted('update:open')).toBeFalsy();
    expect(wrapper.emitted('update:activeSnapPoint')).toBeFalsy();
  });

  it('renders body content for scroll-blocking scenarios', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: {
        open: true,
        snapPoints: ['116px', 0.92],
        activeSnapPoint: 0.92,
        direction: 'bottom',
      },
      slots: {
        default:
          '<div class="body-slot overflow-y-auto" style="height: 200px"><div style="height: 1200px">Body</div></div>',
      },
      global: {
        stubs: {
          UDrawer: drawerStub,
        },
      },
    });

    expect(wrapper.find('.body-slot').exists()).toBe(true);
    expect(wrapper.find('.overflow-y-auto').exists()).toBe(true);
    expect(wrapper.find('[data-vaul-no-drag]').exists()).toBe(true);
    expect(wrapper.emitted('update:open')).toBeFalsy();
    expect(wrapper.emitted('update:activeSnapPoint')).toBeFalsy();
  });

  it('uses a drawer z-index below app modals', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: {
        open: true,
        direction: 'bottom',
      },
      slots: {
        default: '<div class="body-slot">Body</div>',
      },
      global: {
        stubs: {
          UDrawer: drawerStub,
        },
      },
    });

    const drawer = wrapper.findComponent(drawerStub);

    expect(drawer.props('ui')).toMatchObject({
      content: 'z-[var(--z-fixed)] shadow-none ring-0 bg-transparent',
    });
    expect(wrapper.html()).toContain('z-[var(--z-fixed)]');
  });
});
