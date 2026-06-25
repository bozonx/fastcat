import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';

vi.mock('~/composables/useHotkeyLabel', () => ({
  useHotkeyLabel: () => ({
    getHotkeyLabel: () => '',
    getHotkeyTitle: (base: string) => base,
  }),
}));

describe('PropertyActionList', () => {
  it('renders buttons for each visible action', async () => {
    const component = await mountSuspended(PropertyActionList, {
      props: {
        actions: [
          { id: 'cut', label: 'Cut', icon: 'i-heroicons-scissors', onClick: vi.fn() },
          { id: 'copy', label: 'Copy', icon: 'i-heroicons-document', onClick: vi.fn() },
        ],
      },
    });

    const buttons = component.findAll('button');
    expect(buttons.length).toBe(2);
  });

  it('filters out hidden actions', async () => {
    const component = await mountSuspended(PropertyActionList, {
      props: {
        actions: [
          { id: 'cut', label: 'Cut', icon: 'i-heroicons-scissors', onClick: vi.fn() },
          { id: 'hidden', label: 'Hidden', onClick: vi.fn(), hidden: true },
        ],
      },
    });

    const buttons = component.findAll('button');
    expect(buttons.length).toBe(1);
  });

  it('calls onClick when button is clicked', async () => {
    const onClick = vi.fn();
    const component = await mountSuspended(PropertyActionList, {
      props: {
        actions: [{ id: 'delete', label: 'Delete', icon: 'i-heroicons-trash', onClick }],
      },
    });

    await component.find('button').trigger('click');

    expect(onClick).toHaveBeenCalled();
  });

  it('renders vertical layout by default', async () => {
    const component = await mountSuspended(PropertyActionList, {
      props: {
        actions: [{ id: 'test', label: 'Test', onClick: vi.fn() }],
      },
    });

    const container = component.find('.w-full.flex');
    expect(container.classes()).toContain('flex-col');
  });

  it('renders horizontal layout when vertical is false', async () => {
    const component = await mountSuspended(PropertyActionList, {
      props: {
        actions: [{ id: 'test', label: 'Test', onClick: vi.fn() }],
        vertical: false,
      },
    });

    const container = component.find('.w-full.flex');
    expect(container.classes()).not.toContain('flex-col');
  });

  it('applies justify-center class to buttons', async () => {
    const component = await mountSuspended(PropertyActionList, {
      props: {
        actions: [{ id: 'test', label: 'Test', onClick: vi.fn() }],
        justify: 'center',
      },
    });

    const button = component.find('button');
    expect(button.classes()).toContain('justify-center');
  });

  it('renders disabled button when action is disabled', async () => {
    const component = await mountSuspended(PropertyActionList, {
      props: {
        actions: [{ id: 'test', label: 'Test', onClick: vi.fn(), disabled: true }],
      },
    });

    const button = component.find('button');
    expect(button.attributes('disabled')).toBeDefined();
  });

  it('renders empty list when actions is empty', async () => {
    const component = await mountSuspended(PropertyActionList, {
      props: { actions: [] },
    });

    expect(component.findAll('button').length).toBe(0);
  });
});
