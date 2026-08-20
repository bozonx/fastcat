import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import PropertyRow from '~/components/properties/PropertyRow.vue';

describe('PropertyRow', () => {
  it('renders label and value', async () => {
    const component = await mountSuspended(PropertyRow, {
      props: { label: 'Duration', value: '00:01:23' },
    });

    expect(component.text()).toContain('Duration');
    expect(component.text()).toContain('00:01:23');
  });

  it('renders dash when value is null', async () => {
    const component = await mountSuspended(PropertyRow, {
      props: { label: 'Empty', value: null },
    });

    expect(component.text()).toContain('-');
  });

  it('renders dash when value is undefined', async () => {
    const component = await mountSuspended(PropertyRow, {
      props: { label: 'Empty' },
    });

    expect(component.text()).toContain('-');
  });

  it('renders slot content over value prop', async () => {
    const component = await mountSuspended(PropertyRow, {
      props: { label: 'Custom', value: 'prop-value' },
      slots: { default: '<span class="slot-val">slot-value</span>' },
    });

    expect(component.find('.slot-val').exists()).toBe(true);
    expect(component.text()).not.toContain('prop-value');
  });

  it('renders numeric value', async () => {
    const component = await mountSuspended(PropertyRow, {
      props: { label: 'Count', value: 42 },
    });

    expect(component.text()).toContain('42');
  });
});
