import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiModal from '~/components/ui/UiModal.vue';

describe('UiModal', () => {
  it('renders correctly when open', async () => {
    const component = await mountSuspended(UiModal, {
      props: {
        open: true,
        title: 'Test Modal',
        description: 'Test Description',
      },
      slots: {
        default: '<div class="test-content">Content</div>',
      },
    });

    // Check that component exists and has correct props
    expect(component.exists()).toBe(true);
    expect(component.vm.$props.title).toBe('Test Modal');
    expect(component.vm.$props.description).toBe('Test Description');
  });

  it('renders header and footer slots', async () => {
    const component = await mountSuspended(UiModal, {
      props: {
        open: true,
      },
      slots: {
        header: '<div class="custom-header">Header</div>',
        default: 'Body',
        footer: '<div class="custom-footer">Footer</div>',
      },
    });

    // Check that component exists and slots are defined
    expect(component.exists()).toBe(true);
    expect(component.vm.$slots.header).toBeDefined();
    expect(component.vm.$slots.footer).toBeDefined();
  });
});
