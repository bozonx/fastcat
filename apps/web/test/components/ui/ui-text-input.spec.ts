import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiTextInput from '~/components/ui/UiTextInput.vue';

const stubs = {
  UInput: {
    props: [
      'modelValue',
      'type',
      'placeholder',
      'disabled',
      'size',
      'autofocus',
      'variant',
      'autocomplete',
      'ui',
    ],
    emits: ['update:modelValue', 'keyup', 'keydown', 'focus', 'blur'],
    template: `
      <div class="u-input-mock">
        <input
          :value="modelValue"
          :type="type"
          :placeholder="placeholder"
          :disabled="disabled"
          @input="$emit('update:modelValue', $event.target.value)"
          @keyup="$emit('keyup', $event)"
          @keydown="$emit('keydown', $event)"
          @focus="$emit('focus', $event)"
          @blur="$emit('blur', $event)"
        />
      </div>
    `,
  },
};

describe('UiTextInput', () => {
  it('renders with default props', async () => {
    const component = await mountSuspended(UiTextInput, {
      props: { modelValue: '' },
      global: { stubs },
    });

    expect(component.exists()).toBe(true);
    expect(component.find('input').exists()).toBe(true);
  });

  it('displays the model value', async () => {
    const component = await mountSuspended(UiTextInput, {
      props: { modelValue: 'hello world' },
      global: { stubs },
    });

    expect(component.find('input').element.value).toBe('hello world');
  });

  it('emits update:modelValue on input', async () => {
    const component = await mountSuspended(UiTextInput, {
      props: { modelValue: '' },
      global: { stubs },
    });

    await component.find('input').setValue('new text');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')![0]).toEqual(['new text']);
  });

  it('applies full-width class when fullWidth is true', async () => {
    const component = await mountSuspended(UiTextInput, {
      props: { modelValue: '', fullWidth: true },
      global: { stubs },
    });

    expect(component.classes()).toContain('w-full');
  });

  it('applies mono font class when mono is true', async () => {
    const component = await mountSuspended(UiTextInput, {
      props: { modelValue: '', mono: true },
      global: { stubs },
    });

    expect(component.classes()).toContain('font-mono');
  });

  it('disables input when disabled prop is true', async () => {
    const component = await mountSuspended(UiTextInput, {
      props: { modelValue: '', disabled: true },
      global: { stubs },
    });

    expect(component.find('input').attributes('disabled')).toBeDefined();
  });

  it('emits focus and blur events', async () => {
    const component = await mountSuspended(UiTextInput, {
      props: { modelValue: '' },
      global: { stubs },
    });

    await component.find('input').trigger('focus');
    expect(component.emitted('focus')).toBeTruthy();

    await component.find('input').trigger('blur');
    expect(component.emitted('blur')).toBeTruthy();
  });

  it('emits keydown event', async () => {
    const component = await mountSuspended(UiTextInput, {
      props: { modelValue: '' },
      global: { stubs },
    });

    await component.find('input').trigger('keydown', { key: 'Enter' });
    expect(component.emitted('keydown')).toBeTruthy();
  });

  it('sets placeholder', async () => {
    const component = await mountSuspended(UiTextInput, {
      props: { modelValue: '', placeholder: 'Enter name...' },
      global: { stubs },
    });

    expect(component.find('input').attributes('placeholder')).toBe('Enter name...');
  });
});
