import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiFormField from '~/components/ui/UiFormField.vue';

describe('UiFormField', () => {
  it('renders label when provided', async () => {
    const component = await mountSuspended(UiFormField, {
      props: { label: 'Field Label' },
    });

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('Field Label');
  });

  it('renders description when provided', async () => {
    const component = await mountSuspended(UiFormField, {
      props: { label: 'Test', description: 'Helper description' },
    });

    expect(component.text()).toContain('Helper description');
  });

  it('renders help text when provided', async () => {
    const component = await mountSuspended(UiFormField, {
      props: { label: 'Test', help: 'Helpful text' },
    });

    expect(component.text()).toContain('Helpful text');
  });

  it('renders error text when provided', async () => {
    const component = await mountSuspended(UiFormField, {
      props: { label: 'Test', error: 'Something went wrong' },
    });

    expect(component.text()).toContain('Something went wrong');
  });

  it('renders default slot content', async () => {
    const component = await mountSuspended(UiFormField, {
      props: { label: 'Test' },
      slots: { default: '<input class="slot-input" />' },
    });

    expect(component.find('.slot-input').exists()).toBe(true);
  });

  it('passes required prop', async () => {
    const component = await mountSuspended(UiFormField, {
      props: { label: 'Test', required: true },
    });

    expect(component.text()).toContain('Test');
  });
});
