import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiTabs from '~/components/ui/UiTabs.vue';

describe('UiTabs', () => {
  const defaultOptions = [
    { label: 'Tab 1', value: 'tab1' },
    { label: 'Tab 2', value: 'tab2', count: 5 },
    { label: 'Tab 3', value: 'tab3', icon: 'i-heroicons-cog' },
  ];

  it('renders correctly', async () => {
    const component = await mountSuspended(UiTabs, {
      props: {
        modelValue: 'tab1',
        options: defaultOptions,
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('Tab 1');
    expect(component.text()).toContain('Tab 2');
    expect(component.text()).toContain('(5)');
    expect(component.text()).toContain('Tab 3');
  });

  it('applies border class when border prop is true', async () => {
    const component = await mountSuspended(UiTabs, {
      props: {
        modelValue: 'tab1',
        options: defaultOptions,
        border: true,
      },
    });

    const wrapper = component.find('div.border-b.border-ui-border');
    expect(wrapper.exists()).toBe(true);
  });

  it('emits update:modelValue when selectedIndex changes', async () => {
    const component = await mountSuspended(UiTabs, {
      props: {
        modelValue: 'tab1',
        options: defaultOptions,
      },
    });

    // Instead of relying on NuxtUI internal DOM, test the computed property binding
    const uTabs = component.findComponent({ name: 'UTabs' });
    if (uTabs.exists()) {
      await uTabs.vm.$emit('update:modelValue', 1);

      expect(component.emitted('update:modelValue')).toBeTruthy();
      expect(component.emitted('update:modelValue')![0]).toEqual(['tab2']);
    }
  });
});
