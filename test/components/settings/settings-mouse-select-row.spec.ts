import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import SettingsMouseSelectRow from '~/components/settings/SettingsMouseSelectRow.vue';

vi.mock('~/components/ui/UiSelect.vue', () => ({
  default: {
    props: ['modelValue', 'items', 'valueKey', 'labelKey', 'fullWidth', 'searchable'],
    emits: ['update:modelValue'],
    template: '<select class="select-mock" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
  },
}));

describe('SettingsMouseSelectRow', () => {
  const defaultProps = {
    label: 'Click Action',
    modelValue: 'select',
    items: [
      { label: 'Select', value: 'select' },
      { label: 'Zoom', value: 'zoom' },
    ],
    modified: false,
    defaultLabel: '(default)',
    isDefaultValue: (v: string) => v === 'select',
  };

  it('renders as table row with label', async () => {
    const component = await mountSuspended(SettingsMouseSelectRow, {
      props: defaultProps,
    });

    expect(component.find('tr').exists()).toBe(true);
    expect(component.text()).toContain('Click Action');
  });

  it('renders select with options', async () => {
    const component = await mountSuspended(SettingsMouseSelectRow, {
      props: defaultProps,
    });

    const options = component.findAll('option');
    expect(options.length).toBe(2);
  });

  it('emits update:modelValue when select changes', async () => {
    const component = await mountSuspended(SettingsMouseSelectRow, {
      props: defaultProps,
    });

    await component.find('.select-mock').setValue('zoom');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')![0]).toEqual(['zoom']);
  });

  it('applies modified highlight class when modified is true', async () => {
    const component = await mountSuspended(SettingsMouseSelectRow, {
      props: { ...defaultProps, modified: true },
    });

    const firstTd = component.find('td');
    expect(firstTd.classes()).toContain('bg-yellow-400/10');
  });

  it('does not apply modified highlight when modified is false', async () => {
    const component = await mountSuspended(SettingsMouseSelectRow, {
      props: defaultProps,
    });

    const firstTd = component.find('td');
    expect(firstTd.classes()).not.toContain('bg-yellow-400/10');
  });
});
