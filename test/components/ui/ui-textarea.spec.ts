import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiTextarea from '~/components/ui/UiTextarea.vue';

const stubs = {
  UTextarea: {
    props: ['modelValue', 'placeholder', 'disabled', 'size', 'variant', 'rows', 'maxrows', 'autoresize', 'readonly', 'spellcheck', 'ui'],
    emits: ['update:modelValue', 'focus', 'blur'],
    template: `
      <div class="u-textarea-mock">
        <textarea
          :value="modelValue"
          :placeholder="placeholder"
          :disabled="disabled"
          :readonly="readonly"
          @input="$emit('update:modelValue', $event.target.value)"
          @focus="$emit('focus', $event)"
          @blur="$emit('blur', $event)"
        />
      </div>
    `,
  },
};

describe('UiTextarea', () => {
  it('renders with default props', async () => {
    const component = await mountSuspended(UiTextarea, {
      props: { modelValue: '' },
      global: { stubs },
    });

    expect(component.exists()).toBe(true);
    expect(component.find('textarea').exists()).toBe(true);
  });

  it('displays the model value', async () => {
    const component = await mountSuspended(UiTextarea, {
      props: { modelValue: 'some text' },
      global: { stubs },
    });

    expect(component.find('textarea').element.value).toBe('some text');
  });

  it('emits update:modelValue on input', async () => {
    const component = await mountSuspended(UiTextarea, {
      props: { modelValue: '' },
      global: { stubs },
    });

    await component.find('textarea').setValue('new text');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')![0]).toEqual(['new text']);
  });

  it('applies full-width class when fullWidth is true', async () => {
    const component = await mountSuspended(UiTextarea, {
      props: { modelValue: '', fullWidth: true },
      global: { stubs },
    });

    expect(component.classes()).toContain('w-full');
  });

  it('disables textarea when disabled prop is true', async () => {
    const component = await mountSuspended(UiTextarea, {
      props: { modelValue: '', disabled: true },
      global: { stubs },
    });

    expect(component.find('textarea').attributes('disabled')).toBeDefined();
  });

  it('emits focus and blur events', async () => {
    const component = await mountSuspended(UiTextarea, {
      props: { modelValue: '' },
      global: { stubs },
    });

    await component.find('textarea').trigger('focus');
    expect(component.emitted('focus')).toBeTruthy();

    await component.find('textarea').trigger('blur');
    expect(component.emitted('blur')).toBeTruthy();
  });

  it('sets placeholder', async () => {
    const component = await mountSuspended(UiTextarea, {
      props: { modelValue: '', placeholder: 'Enter description...' },
      global: { stubs },
    });

    expect(component.find('textarea').attributes('placeholder')).toBe('Enter description...');
  });

  it('sets readonly attribute', async () => {
    const component = await mountSuspended(UiTextarea, {
      props: { modelValue: '', readonly: true },
      global: { stubs },
    });

    expect(component.find('textarea').attributes('readonly')).toBeDefined();
  });
});
