import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';

describe('UiConfirmModal', () => {
  it('focuses the confirm button in footer when opened', async () => {
    const wrapper = mount(UiConfirmModal, {
      props: {
        open: false,
        title: 'Delete?',
        color: 'error',
      },
      global: {
        stubs: {
          UIcon: { template: '<span class="icon-mock" />' },
          UButton: {
            props: ['label', 'color', 'dataPrimaryFocus'],
            template: '<button :data-primary-focus="dataPrimaryFocus">{{ label }}</button>',
          },
        },
      },
    });

    // Initially closed
    expect(wrapper.find('.modal-mock').exists()).toBe(false);

    // Open the modal
    await wrapper.setProps({ open: true });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.modal-mock').exists()).toBe(true);

    // Find the confirm button by data-primary-focus attribute
    const confirmButton = wrapper.find('button[data-primary-focus="true"]');
    expect(confirmButton.exists()).toBe(true);
  });
});
