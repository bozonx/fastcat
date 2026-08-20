import { describe, it, expect, vi } from 'vitest';
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

  it('suppresses the click that follows an outside pointerdown', async () => {
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
    const content = modal.props('content') as {
      onPointerDownOutside: (event: Event) => void;
    };
    const outsideEvent = new Event('pointerDownOutside') as Event & {
      detail: { originalEvent: MouseEvent };
    };
    outsideEvent.detail = {
      originalEvent: new MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
    };

    content.onPointerDownOutside(outsideEvent);

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const stopPropagation = vi.spyOn(clickEvent, 'stopPropagation');
    const stopImmediatePropagation = vi.spyOn(clickEvent, 'stopImmediatePropagation');

    document.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it('forwards the portal prop to UModal', async () => {
    const component = await mountSuspended(UiModal, {
      props: {
        open: true,
        portal: '#custom-portal',
      },
      global: {
        stubs: {
          UModal: {
            ...modalStub,
            props: [...modalStub.props, 'portal'],
          },
        },
      },
    });

    const modal = component.findComponent({ name: 'UModal' });
    expect(modal.props('portal')).toBe('#custom-portal');
  });
});
