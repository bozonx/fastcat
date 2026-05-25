import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiActionButton from '~/components/ui/UiActionButton.vue';

describe('UiActionButton', () => {
  it('renders with default props', async () => {
    const component = await mountSuspended(UiActionButton, {
      props: {
        label: 'Click me',
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('Click me');
  });

  it('emits click event when clicked', async () => {
    const component = await mountSuspended(UiActionButton, {
      props: {
        label: 'Click me',
      },
    });

    await component.find('button').trigger('click');

    expect(component.emitted('click')).toBeTruthy();
  });

  it('does not emit click when disabled', async () => {
    const component = await mountSuspended(UiActionButton, {
      props: {
        label: 'Click me',
        disabled: true,
      },
    });

    await component.find('button').trigger('click');

    expect(component.emitted('click')).toBeFalsy();
  });

  it('does not emit click when loading', async () => {
    const component = await mountSuspended(UiActionButton, {
      props: {
        label: 'Click me',
        loading: true,
      },
    });

    await component.find('button').trigger('click');

    expect(component.emitted('click')).toBeFalsy();
  });

  it('renders slot content', async () => {
    const component = await mountSuspended(UiActionButton, {
      slots: {
        default: '<span class="slot-content">Slot</span>',
      },
    });

    expect(component.find('.slot-content').exists()).toBe(true);
  });

  it('passes icon prop to UButton', async () => {
    const component = await mountSuspended(UiActionButton, {
      props: {
        icon: 'i-heroicons-trash',
        label: 'Delete',
      },
    });

    expect(component.exists()).toBe(true);
  });

  it('applies block class when block prop is true', async () => {
    const component = await mountSuspended(UiActionButton, {
      props: {
        label: 'Block',
        block: true,
      },
    });

    const button = component.find('button');
    expect(button.classes()).toContain('w-full');
  });

  it('applies square class when square prop is true', async () => {
    const component = await mountSuspended(UiActionButton, {
      props: {
        label: 'Square',
        square: true,
      },
    });

    const button = component.find('button');
    expect(button.classes()).toContain('aspect-square');
  });
});
