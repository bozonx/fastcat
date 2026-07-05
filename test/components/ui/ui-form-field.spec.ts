import { describe, it, expect } from 'vitest';
import { h } from 'vue';
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

  describe('resettable', () => {
    it('shows reset button when resettable is true', async () => {
      const component = await mountSuspended(UiFormField, {
        props: { label: 'Test', resettable: true },
        slots: { default: () => h('span', { class: 'field-content' }, 'Value') },
      });

      // The slot content should still be rendered
      expect(component.find('.field-content').exists()).toBe(true);
      // The flex wrapper should be present
      expect(component.find('.flex.items-center.gap-2').exists()).toBe(true);
    });

    it('hides reset button when resettable is false', async () => {
      const component = await mountSuspended(UiFormField, {
        props: { label: 'Test', resettable: false },
        slots: { default: () => h('span', { class: 'field-content' }, 'Value') },
      });

      // The flex wrapper should be present (resettable !== undefined)
      expect(component.find('.flex.items-center.gap-2').exists()).toBe(true);
      // Slot content should still render
      expect(component.find('.field-content').exists()).toBe(true);
    });

    it('does not show reset button when resettable is undefined', async () => {
      const component = await mountSuspended(UiFormField, {
        props: { label: 'Test' },
        slots: { default: () => h('span', { class: 'field-content' }, 'Value') },
      });

      // No reset button should be present
      expect(component.find('button').exists()).toBe(false);
      // Slot content is rendered directly
      expect(component.find('.field-content').exists()).toBe(true);
    });

    it('emits reset when button is clicked', async () => {
      const component = await mountSuspended(UiFormField, {
        props: { label: 'Test', resettable: true, resetTooltip: 'Reset it' },
        slots: { default: () => h('span', null, 'Value') },
      });

      // UButton inside UiTooltip renders as a native <button>
      const btn = component.find('button');
      expect(btn.exists()).toBe(true);
      await btn.trigger('click');

      expect(component.emitted('reset')).toBeTruthy();
    });
  });
});

