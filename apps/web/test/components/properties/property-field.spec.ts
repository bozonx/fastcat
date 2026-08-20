import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import PropertyField from '~/components/properties/PropertyField.vue';

describe('PropertyField', () => {
  it('renders label', async () => {
    const component = await mountSuspended(PropertyField, {
      props: { label: 'Volume' },
    });

    expect(component.text()).toContain('Volume');
  });

  it('renders slot content', async () => {
    const component = await mountSuspended(PropertyField, {
      props: { label: 'Speed' },
      slots: { default: '<input type="range" class="slot-input" />' },
    });

    expect(component.find('.slot-input').exists()).toBe(true);
  });

  it('has flex column layout', async () => {
    const component = await mountSuspended(PropertyField, {
      props: { label: 'Test' },
    });

    expect(component.find('.flex.flex-col').exists()).toBe(true);
  });
});
