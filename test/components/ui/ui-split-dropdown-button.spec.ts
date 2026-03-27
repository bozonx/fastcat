import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiSplitDropdownButton from '~/components/ui/UiSplitDropdownButton.vue';

describe('UiSplitDropdownButton', () => {
  const dummyItems = [[{ label: 'Item 1' }, { label: 'Item 2' }]];

  it('renders correctly', async () => {
    const component = await mountSuspended(UiSplitDropdownButton, {
      props: {
        ariaLabel: 'Main Action',
        items: dummyItems,
      },
    });

    expect(component.exists()).toBe(true);
    const buttons = component.findAll('button');
    // Should render main button and dropdown trigger button
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('passes ariaLabel to main button', async () => {
    const component = await mountSuspended(UiSplitDropdownButton, {
      props: {
        ariaLabel: 'Main Action',
        items: dummyItems,
      },
    });

    const buttons = component.findAll('button');
    const mainButton = buttons[0];
    expect(mainButton.attributes('aria-label')).toBe('Main Action');
  });

  it('uses caretAriaLabel for dropdown button if provided', async () => {
    const component = await mountSuspended(UiSplitDropdownButton, {
      props: {
        ariaLabel: 'Main Action',
        caretAriaLabel: 'More Options',
        items: dummyItems,
      },
    });

    const buttons = component.findAll('button');
    const caretButton = buttons[1];
    expect(caretButton.attributes('aria-label')).toBe('More Options');
  });

  it('falls back to ariaLabel for dropdown button if caretAriaLabel is not provided', async () => {
    const component = await mountSuspended(UiSplitDropdownButton, {
      props: {
        ariaLabel: 'Main Action',
        items: dummyItems,
      },
    });

    const buttons = component.findAll('button');
    const caretButton = buttons[1];
    expect(caretButton.attributes('aria-label')).toBe('Main Action');
  });

  it('emits click event when main button is clicked', async () => {
    const component = await mountSuspended(UiSplitDropdownButton, {
      props: {
        ariaLabel: 'Main Action',
        items: dummyItems,
      },
    });

    const buttons = component.findAll('button');
    const mainButton = buttons[0];

    await mainButton.trigger('click');

    expect(component.emitted('click')).toBeTruthy();
    expect(component.emitted('click')!.length).toBe(1);
  });

  it('does not emit click event when disabled', async () => {
    const component = await mountSuspended(UiSplitDropdownButton, {
      props: {
        ariaLabel: 'Main Action',
        disabled: true,
        items: dummyItems,
      },
    });

    const buttons = component.findAll('button');
    const mainButton = buttons[0];
    await mainButton.trigger('click');

    expect(component.emitted('click')).toBeFalsy();
  });
});
