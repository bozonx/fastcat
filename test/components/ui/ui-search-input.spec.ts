import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiSearchInput from '~/components/ui/UiSearchInput.vue';

describe('UiSearchInput', () => {
  it('renders correctly', async () => {
    const component = await mountSuspended(UiSearchInput, {
      props: {
        modelValue: '',
      },
    });

    expect(component.exists()).toBe(true);
    const input = component.find('input');
    expect(input.exists()).toBe(true);
  });

  it('uses the provided placeholder', async () => {
    const component = await mountSuspended(UiSearchInput, {
      props: {
        placeholder: 'Find something...',
        modelValue: '',
      },
    });

    const input = component.find('input');
    expect(input.attributes('placeholder')).toBe('Find something...');
  });

  it('disables the input when disabled prop is true', async () => {
    const component = await mountSuspended(UiSearchInput, {
      props: {
        disabled: true,
        modelValue: '',
      },
    });

    const input = component.find('input');
    expect(input.attributes('disabled')).toBeDefined();
  });

  it('emits update:modelValue when typing', async () => {
    const component = await mountSuspended(UiSearchInput, {
      props: {
        modelValue: '',
      },
    });

    const input = component.find('input');
    await input.setValue('new search term');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.[0]).toEqual(['new search term']);
  });

  it('shows clear button when modelValue has text', async () => {
    const component = await mountSuspended(UiSearchInput, {
      props: {
        modelValue: 'has text',
      },
    });

    const clearButton = component.find('button');
    expect(clearButton.exists()).toBe(true);
  });

  it('does not show clear button when modelValue is empty', async () => {
    const component = await mountSuspended(UiSearchInput, {
      props: {
        modelValue: '',
      },
    });

    const clearButton = component.find('button');
    expect(clearButton.exists()).toBe(false);
  });

  it('clears the modelValue when the clear button is clicked', async () => {
    const component = await mountSuspended(UiSearchInput, {
      props: {
        modelValue: 'text to clear',
      },
    });

    const clearButton = component.find('button');
    expect(clearButton.exists()).toBe(true);

    await clearButton.trigger('click');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.slice(-1)[0]).toEqual(['']);
  });
});
