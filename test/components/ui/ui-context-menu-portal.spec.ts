import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';

describe('UiContextMenuPortal', () => {
  it('does not render menu when closed', async () => {
    const component = await mountSuspended(UiContextMenuPortal, {
      props: { items: [[{ label: 'Action 1' }]], targetEl: null },
    });

    expect(component.find('.absolute.z-99999').exists()).toBe(false);
  });

  it('exposes open and close methods', async () => {
    const component = await mountSuspended(UiContextMenuPortal, {
      props: { items: [[]], targetEl: null },
    });

    expect(typeof component.vm.open).toBe('function');
    expect(typeof component.vm.close).toBe('function');
  });

  it('renders menu items when open is called with target', async () => {
    const targetEl = document.createElement('div');
    document.body.appendChild(targetEl);

    const component = await mountSuspended(UiContextMenuPortal, {
      props: {
        items: [
          [{ label: 'Copy', icon: 'i-heroicons-copy' }],
          [{ label: 'Paste' }, { label: 'Delete', disabled: true }],
        ],
        targetEl,
      },
    });

    component.vm.open({
      preventDefault() {},
      stopPropagation() {},
      clientX: 10,
      clientY: 10,
    } as unknown as MouseEvent);
    await component.vm.$nextTick();

    expect(component.emitted()).toBeTruthy();

    document.body.removeChild(targetEl);
  });

  it('closes when close is called', async () => {
    const component = await mountSuspended(UiContextMenuPortal, {
      props: { items: [[]], targetEl: null },
    });

    component.vm.close();
    await component.vm.$nextTick();

    expect(component.find('.absolute.z-99999').exists()).toBe(false);
  });
});
