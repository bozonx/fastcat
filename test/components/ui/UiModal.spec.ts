import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import UiModal from '~/components/ui/UiModal.vue';

describe('UiModal', () => {
  it('focuses data-primary-focus element in footer when opened', async () => {
    const wrapper = mount(UiModal, {
      props: {
        open: false,
        title: 'Test Modal',
      },
      slots: {
        default: '<div>Body content</div>',
        footer: '<button data-primary-focus="true" class="focus-target">Confirm</button>',
      },
    });

    // Open the modal
    await wrapper.setProps({ open: true });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.modal-mock').exists()).toBe(true);

    const focusTarget = wrapper.find('button[data-primary-focus="true"]');
    expect(focusTarget.exists()).toBe(true);

    // In happy-dom, focus() on a button with default tabindex should work
    // The onOpenAutoFocus handler in UiModal calls focusPreferredElement
    // which focuses the element if it is focusable
    expect(focusTarget.element).toBe(document.activeElement);
  });

  it('focuses data-primary-focus element in body when no footer is present', async () => {
    const wrapper = mount(UiModal, {
      props: {
        open: false,
        title: 'Test Modal',
      },
      slots: {
        default: '<button data-primary-focus="true" class="body-focus">Confirm</button>',
      },
    });

    await wrapper.setProps({ open: true });
    await wrapper.vm.$nextTick();

    const focusTarget = wrapper.find('button[data-primary-focus="true"]');
    expect(focusTarget.exists()).toBe(true);
    expect(focusTarget.element).toBe(document.activeElement);
  });
});
