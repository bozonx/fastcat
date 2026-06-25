import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import PropertySection from '~/components/properties/PropertySection.vue';

vi.mock('~/components/ui/UiFormSectionHeader.vue', () => ({
  default: {
    props: ['title'],
    template: '<div class="header-mock"><span>{{ title }}</span><slot /></div>',
  },
}));

const stubs = {
  USwitch: {
    props: ['modelValue', 'size', 'color'],
    emits: ['update:modelValue'],
    template: '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" class="switch-mock" />',
  },
};

describe('PropertySection', () => {
  it('renders section with title', async () => {
    const component = await mountSuspended(PropertySection, {
      props: { title: 'Transform' },
      global: { stubs },
    });

    expect(component.text()).toContain('Transform');
  });

  it('renders default slot content', async () => {
    const component = await mountSuspended(PropertySection, {
      props: { title: 'Section' },
      slots: { default: '<div class="content">Content</div>' },
      global: { stubs },
    });

    expect(component.find('.content').exists()).toBe(true);
  });

  it('renders header-actions slot', async () => {
    const component = await mountSuspended(PropertySection, {
      props: { title: 'Section' },
      slots: { 'header-actions': '<button class="action-btn">Action</button>' },
      global: { stubs },
    });

    expect(component.find('.action-btn').exists()).toBe(true);
  });

  it('renders reset button when showReset and onReset are provided', async () => {
    const onReset = vi.fn();
    const component = await mountSuspended(PropertySection, {
      props: { title: 'Section', showReset: true, onReset },
      global: { stubs },
    });

    const resetButton = component.find('button[title]');
    expect(resetButton.exists()).toBe(true);
  });

  it('calls onReset when reset button is clicked', async () => {
    const onReset = vi.fn();
    const component = await mountSuspended(PropertySection, {
      props: { title: 'Section', showReset: true, onReset },
      global: { stubs },
    });

    const resetButton = component.find('button[title]');
    await resetButton.trigger('click');

    expect(onReset).toHaveBeenCalled();
  });

  it('renders toggle switch when hasToggle is true', async () => {
    const component = await mountSuspended(PropertySection, {
      props: { title: 'Section', hasToggle: true },
      global: { stubs },
    });

    expect(component.find('.switch-mock').exists()).toBe(true);
  });

  it('does not render header when no title, no toggle, no reset', async () => {
    const component = await mountSuspended(PropertySection, {
      global: { stubs },
    });

    expect(component.find('.header-mock').exists()).toBe(false);
  });
});
