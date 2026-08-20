import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiCompactSelect from '~/components/ui/UiCompactSelect.vue';

const stubs = {
  USelectMenu: {
    props: [
      'modelValue',
      'items',
      'placeholder',
      'disabled',
      'size',
      'valueKey',
      'labelKey',
      'multiple',
      'searchInput',
      'ui',
    ],
    emits: ['update:modelValue'],
    computed: {
      vk() {
        return (this as any).valueKey || 'value';
      },
      lk() {
        return (this as any).labelKey || 'label';
      },
    },
    template: `
      <div class="u-compact-select-mock">
        <select :disabled="disabled" @change="$emit('update:modelValue', $event.target.value)">
          <option v-for="item in items" :key="item[vk]" :value="item[vk]">{{ item[lk] }}</option>
        </select>
      </div>
    `,
  },
};

describe('UiCompactSelect', () => {
  const sampleItems = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];

  it('renders with items', async () => {
    const component = await mountSuspended(UiCompactSelect, {
      props: { modelValue: 'a', items: sampleItems },
      global: { stubs },
    });

    expect(component.exists()).toBe(true);
    expect(component.findAll('option').length).toBe(2);
  });

  it('applies full-width class when fullWidth is true', async () => {
    const component = await mountSuspended(UiCompactSelect, {
      props: { modelValue: 'a', items: sampleItems, fullWidth: true },
      global: { stubs },
    });

    expect(component.classes()).toContain('w-full');
  });

  it('applies auto width class when fullWidth is false', async () => {
    const component = await mountSuspended(UiCompactSelect, {
      props: { modelValue: 'a', items: sampleItems, fullWidth: false },
      global: { stubs },
    });

    expect(component.classes()).toContain('w-auto');
  });

  it('disables select when disabled prop is true', async () => {
    const component = await mountSuspended(UiCompactSelect, {
      props: { modelValue: 'a', items: sampleItems, disabled: true },
      global: { stubs },
    });

    expect(component.find('select').attributes('disabled')).toBeDefined();
  });

  it('emits update:modelValue on change', async () => {
    const component = await mountSuspended(UiCompactSelect, {
      props: { modelValue: 'a', items: sampleItems },
      global: { stubs },
    });

    await component.find('select').setValue('b');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')![0]).toEqual(['b']);
  });
});
