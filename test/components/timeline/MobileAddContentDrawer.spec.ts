import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { ref } from 'vue';
import MobileAddContentDrawer from '~/components/timeline/MobileAddContentDrawer.vue';

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

describe('MobileAddContentDrawer', () => {
  beforeEach(() => {
    mockWidth.value = 390;
    mockHeight.value = 844;
  });

  it('closes itself before opening the media picker', async () => {
    const wrapper = await mountSuspended(MobileAddContentDrawer, {
      props: {
        isOpen: true,
      },
      global: {
        stubs: {
          UiMobileDrawer: {
            name: 'UiMobileDrawer',
            props: ['open', 'showClose', 'direction'],
            template: '<div v-if="open" class="ui-mobile-drawer-stub"><slot /></div>',
          },
          MobileMediaPickerDrawer: {
            name: 'MobileMediaPickerDrawer',
            props: ['isOpen'],
            template: '<div v-if="isOpen" class="media-picker-stub" />',
          },
        },
      },
    });

    // Ensure the drawer is open
    expect(wrapper.find('.ui-mobile-drawer-stub').exists()).toBe(true);
    expect(wrapper.find('.media-picker-stub').exists()).toBe(false);

    // Click the "From Project Files" button (openMediaPicker)
    const fromProjectBtn = wrapper
      .findAll('button')
      .find((btn) => btn.text().includes('fastcat.timeline.fromProjectFiles'));

    expect(fromProjectBtn).toBeDefined();
    await fromProjectBtn!.trigger('click');

    // The parent drawer should have emitted close immediately
    expect(wrapper.emitted('close')).toBeTruthy();
    expect(wrapper.emitted('close')!.length).toBe(1);

    // After nextTick the media picker should be rendered
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.media-picker-stub').exists()).toBe(true);

    // Simulate picker finishing its work — it should NOT emit close from parent drawer
    const picker = wrapper.findComponent({ name: 'MobileMediaPickerDrawer' });
    await picker.vm.$emit('added');
    // No extra 'close' should be fired because the parent is already closed
    expect(wrapper.emitted('close')!.length).toBe(1);
  });
});
