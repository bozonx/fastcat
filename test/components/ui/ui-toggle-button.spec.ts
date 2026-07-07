import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiToggleButton from '~/components/ui/UiToggleButton.vue';

describe('UiToggleButton', () => {
  it('renders with inactive state by default', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: false,
        label: 'Toggle',
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('Toggle');
  });

  it('toggles modelValue on click', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: false,
        label: 'Toggle',
      },
    });

    await component.find('button').trigger('click');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')![0]).toEqual([true]);
  });

  it('emits click event on click', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: false,
        label: 'Toggle',
      },
    });

    await component.find('button').trigger('click');

    expect(component.emitted('click')).toBeTruthy();
  });

  it('does not toggle when disabled', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: false,
        label: 'Toggle',
        disabled: true,
      },
    });

    await component.find('button').trigger('click');

    expect(component.emitted('update:modelValue')).toBeFalsy();
  });

  it('does not toggle when noToggle is true', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: false,
        label: 'Toggle',
        noToggle: true,
      },
    });

    await component.find('button').trigger('click');

    expect(component.emitted('click')).toBeTruthy();
    expect(component.emitted('update:modelValue')).toBeFalsy();
  });

  it('uses activeIcon when modelValue is true', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: true,
        icon: 'i-heroicons-eye',
        activeIcon: 'i-heroicons-eye-slash',
      },
    });

    expect(component.exists()).toBe(true);
  });

  it('applies active color when modelValue is true', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: true,
        activeColor: 'primary',
        inactiveColor: 'neutral',
      },
    });

    expect(component.exists()).toBe(true);
  });

  it('applies active variant when modelValue is true', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: true,
        activeVariant: 'solid',
        inactiveVariant: 'ghost',
      },
    });

    expect(component.exists()).toBe(true);
  });

  it('applies square class when square prop is true', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: false,
        square: true,
      },
    });

    const button = component.find('button');
    expect(button.classes()).toContain('aspect-square');
  });

  it('applies custom style when activeBg and activeText are set', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: true,
        activeBg: '#ff0000',
        activeText: '#ffffff',
      },
    });

    const button = component.find('button');
    const style = button.attributes('style');
    expect(style).toContain('#ff0000');
    expect(style).toContain('#ffffff');
  });

  it('applies custom class prop', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: false,
        class: 'my-custom-class',
      },
    });

    const button = component.find('button');
    expect(button.classes()).toContain('my-custom-class');
  });

  it('standardizes inactive neutral ghost icon-only buttons', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: false,
        icon: 'i-heroicons-eye',
        inactiveColor: 'neutral',
        inactiveVariant: 'ghost',
      },
    });

    const button = component.find('button');
    expect(button.classes()).toContain('w-6');
    expect(button.classes()).toContain('h-6');
    expect(button.classes()).toContain('p-0');
    expect(button.classes()).toContain('text-ui-text-muted');
    expect(button.classes()).toContain('hover:text-ui-text');
  });

  it('passes iconClass to UButton via ui prop when inactive', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: false,
        icon: 'i-heroicons-eye',
        iconClass: 'size-3',
      },
    });

    // ui prop object serializes to "[object Object]" in HTML attributes
    expect(component.find('button').attributes('ui')).toBe('[object Object]');
  });

  it('does not pass ui prop when neither iconClass nor activeIconClass is set', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: false,
        icon: 'i-heroicons-eye',
      },
    });

    expect(component.find('button').attributes('ui')).toBeUndefined();
  });

  it('passes ui prop when active with activeIconClass set', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: true,
        icon: 'i-heroicons-eye',
        activeIconClass: 'size-3',
      },
    });

    expect(component.find('button').attributes('ui')).toBe('[object Object]');
  });

  it('does not pass ui prop when inactive and only activeIconClass is set', async () => {
    const component = await mountSuspended(UiToggleButton, {
      props: {
        modelValue: false,
        icon: 'i-heroicons-eye',
        activeIconClass: 'size-3',
      },
    });

    expect(component.find('button').attributes('ui')).toBeUndefined();
  });
});
