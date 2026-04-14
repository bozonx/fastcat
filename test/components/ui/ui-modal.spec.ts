import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiModal from '~/components/ui/UiModal.vue';

const modalStub = {
  name: 'UModal',
  props: [
    'open',
    'content',
    'dismissible',
    'title',
    'description',
    'ariaDescribedby',
    'close',
    'ui',
  ],
  template: '<div class="u-modal-stub"><slot name="body" /></div>',
};

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

  it('applies modal z-index classes above drawers', async () => {
    const component = await mountSuspended(UiModal, {
      props: {
        open: true,
      },
      slots: {
        default: 'Body',
      },
      global: {
        stubs: {
          UModal: modalStub,
        },
      },
    });

    const modal = component.findComponent(modalStub);
    const ui = modal.props('ui') as Record<string, string>;

    expect(ui.overlay).toContain('z-[var(--z-modal-backdrop)]');
    expect(ui.content).toContain('z-[var(--z-modal)]');
  });

  it('preserves base z-index when custom ui content classes are passed', async () => {
    const component = await mountSuspended(UiModal, {
      props: {
        open: true,
        ui: {
          content: 'sm:max-w-lg',
          overlay: 'bg-black/80',
        },
      },
      slots: {
        default: 'Body',
      },
      global: {
        stubs: {
          UModal: modalStub,
        },
      },
    });

    const modal = component.findComponent(modalStub);
    const ui = modal.props('ui') as Record<string, string>;

    expect(ui.overlay).toContain('z-[var(--z-modal-backdrop)]');
    expect(ui.overlay).toContain('bg-black/80');
    expect(ui.content).toContain('z-[var(--z-modal)]');
    expect(ui.content).toContain('sm:max-w-lg');
  });
});
