import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { ref } from 'vue';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';

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
          UDrawer: {
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
          },
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

  it('does not close when tapping the handle in expanded mode', async () => {
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
          UDrawer: {
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
          },
        },
      },
    });

    const handle = wrapper.find('.group');
    expect(handle.exists()).toBe(true);

    await handle.trigger('click');

    expect(wrapper.emitted('update:open')).toBeFalsy();
    expect(wrapper.emitted('update:activeSnapPoint')).toBeFalsy();
  });

  it('does not close from handle tap without snap points when the drawer is already open', async () => {
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
          UDrawer: {
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
          },
        },
      },
    });

    const handle = wrapper.find('.group');
    expect(handle.exists()).toBe(true);

    await handle.trigger('click');

    expect(wrapper.emitted('update:open')).toBeFalsy();
    expect(wrapper.emitted('update:activeSnapPoint')).toBeFalsy();
  });
});
