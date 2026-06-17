import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { ref, nextTick } from 'vue';
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
  emits: ['update:open', 'update:activeSnapPoint'],
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
      content:
        'mobile-drawer-vaul-content z-[var(--z-fixed)] shadow-none ring-0 bg-transparent mt-0',
    });
    expect(wrapper.html()).toContain('z-[var(--z-fixed)]');
  });

  it('renders vertical numeric snap points as integer pixel values for sharp text', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: {
        open: true,
        snapPoints: ['116px', 0.92],
        activeSnapPoint: 0.92,
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

    expect(drawer.props('snapPoints')).toEqual(['116px', '776px']);
    expect(drawer.props('activeSnapPoint')).toBe('776px');
  });

  it('keeps drawer content out of rasterized text layers', async () => {
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

    const container = wrapper.find('.pointer-events-auto.z-\\[var\\(--z-fixed\\)\\]');

    expect(container.exists()).toBe(true);
    expect(container.classes()).not.toContain('transform-gpu');
    expect(container.classes()).not.toContain('antialiased');
    expect(container.classes().some((className) => className.startsWith('backdrop-blur'))).toBe(
      false,
    );
  });

  it('auto-detects bottom direction in portrait and right in landscape', async () => {
    const portrait = await mountSuspended(UiMobileDrawer, {
      props: { open: true },
      slots: { default: '<div>Body</div>' },
      global: { stubs: { UDrawer: drawerStub } },
    });
    expect(portrait.findComponent(drawerStub).props('direction')).toBe('bottom');

    mockWidth.value = 844;
    mockHeight.value = 390;

    const landscape = await mountSuspended(UiMobileDrawer, {
      props: { open: true },
      slots: { default: '<div>Body</div>' },
      global: { stubs: { UDrawer: drawerStub } },
    });
    expect(landscape.findComponent(drawerStub).props('direction')).toBe('right');
  });

  it('renders side handle for right direction and hides vertical handle', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: { open: true, direction: 'right' },
      slots: { default: '<div>Body</div>' },
      global: { stubs: { UDrawer: drawerStub } },
    });

    expect(wrapper.find('.absolute.top-0.bottom-0.flex.flex-col').exists()).toBe(true);
    expect(wrapper.find('.group').exists()).toBe(false);
  });

  it('closes when clicking the backdrop', async () => {
    vi.useFakeTimers();
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: { open: true, overlay: true },
      slots: { default: '<div>Body</div>' },
      global: { stubs: { UDrawer: drawerStub } },
    });

    vi.advanceTimersByTime(100);

    const backdrops = document.querySelectorAll('.fixed.inset-0.bg-ui-bg\\/40');
    expect(backdrops.length).toBeGreaterThan(0);
    const backdrop = backdrops[backdrops.length - 1] as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
    expect(wrapper.emitted('close')).toBeTruthy();
    vi.useRealTimers();
  });

  it('closes when clicking the close button', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: { open: true, title: 'Test' },
      slots: { default: '<div>Body</div>' },
      global: { stubs: { UDrawer: drawerStub } },
    });

    const closeBtn = wrapper.find('button');
    expect(closeBtn.exists()).toBe(true);
    await closeBtn.trigger('click');

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('renders footer slot', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: { open: true },
      slots: {
        default: '<div>Body</div>',
        footer: '<div class="footer-slot">Footer</div>',
      },
      global: { stubs: { UDrawer: drawerStub } },
    });

    expect(wrapper.find('.footer-slot').exists()).toBe(true);
  });

  it('renders custom header slot', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: { open: true },
      slots: {
        default: '<div>Body</div>',
        header: '<div class="header-slot">Custom Header</div>',
      },
      global: { stubs: { UDrawer: drawerStub } },
    });

    expect(wrapper.find('.header-slot').exists()).toBe(true);
  });

  it('passes title and description to UDrawer for a11y', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: { open: true, title: 'My Title', description: 'My Description' },
      slots: { default: '<div>Body</div>' },
      global: { stubs: { UDrawer: drawerStub } },
    });

    const drawer = wrapper.findComponent(drawerStub);
    expect(drawer.props('title')).toBe('My Title');
    expect(drawer.props('description')).toBe('My Description');
  });

  it('falls back to default a11y title and description when props are empty', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: { open: true },
      slots: { default: '<div>Body</div>' },
      global: { stubs: { UDrawer: drawerStub } },
    });

    const drawer = wrapper.findComponent(drawerStub);
    expect(drawer.props('title')).toBe('Panel');
    expect(drawer.props('description')).toBe('\u00A0');
  });

  it('computes correct backdrop z-index for custom z-index prop', async () => {
    await mountSuspended(UiMobileDrawer, {
      props: { open: true, zIndex: 'z-[100]' },
      slots: { default: '<div>Body</div>' },
      global: { stubs: { UDrawer: drawerStub } },
    });

    const backdrops = document.querySelectorAll('.fixed.inset-0.bg-ui-bg\\/40');
    expect(backdrops.length).toBeGreaterThan(0);
    const backdrop = backdrops[backdrops.length - 1] as HTMLElement;
    expect(backdrop.className.includes('z-[99]')).toBe(true);
  });

  it('passes dismissible and shouldScaleBackground to UDrawer', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: { open: true, dismissible: false, shouldScaleBackground: true },
      slots: { default: '<div>Body</div>' },
      global: { stubs: { UDrawer: drawerStub } },
    });

    const drawer = wrapper.findComponent(drawerStub);
    expect(drawer.props('dismissible')).toBe(false);
    expect(drawer.props('shouldScaleBackground')).toBe(true);
  });

  it('applies full-height class when isFullHeight is true without snap points', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: { open: true, isFullHeight: true },
      slots: { default: '<div>Body</div>' },
      global: { stubs: { UDrawer: drawerStub } },
    });

    const container = wrapper.find('.pointer-events-auto');
    expect(container.classes().join(' ')).toContain('h-[95dvh]');
  });

  it('does not render handle when withHandle is false', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: { open: true, withHandle: false },
      slots: { default: '<div>Body</div>' },
      global: { stubs: { UDrawer: drawerStub } },
    });

    expect(wrapper.find('.group').exists()).toBe(false);
    expect(wrapper.find('.absolute.top-0.bottom-0').exists()).toBe(false);
  });

  it('does not render close button when showClose is false', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: { open: true, title: 'Test', showClose: false },
      slots: { default: '<div>Body</div>' },
      global: { stubs: { UDrawer: drawerStub } },
    });

    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('maps rendered snap point back to original value on snap point change', async () => {
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: { open: true, snapPoints: [0.25, 0.92], activeSnapPoint: 0.92 },
      slots: { default: '<div>Body</div>' },
      global: { stubs: { UDrawer: drawerStub } },
    });

    const drawer = wrapper.findComponent(drawerStub);
    await drawer.vm.$emit('update:activeSnapPoint', '211px');

    expect(wrapper.emitted('update:activeSnapPoint')?.at(-1)).toEqual([0.25]);
  });

  it('keeps backdrop non-interactive when drawer is not expanded', async () => {
    vi.useFakeTimers();
    const wrapper = await mountSuspended(UiMobileDrawer, {
      props: {
        open: true,
        snapPoints: ['116px', 0.92],
        activeSnapPoint: '116px',
        overlay: true,
      },
      slots: { default: '<div>Body</div>', toolbar: '<div>Toolbar</div>' },
      global: { stubs: { UDrawer: drawerStub } },
    });

    vi.advanceTimersByTime(100);

    const backdrop = document.querySelector('.fixed.inset-0.bg-ui-bg\\/40');
    expect(backdrop).not.toBeNull();
    expect((backdrop as HTMLElement).classList.contains('pointer-events-none')).toBe(true);
    expect((backdrop as HTMLElement).classList.contains('opacity-0')).toBe(true);

    vi.useRealTimers();
  });
});
