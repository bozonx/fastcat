import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiEntityCreationModal from '~/components/ui/UiEntityCreationModal.vue';

const stubs = {
  UButton: {
    props: ['label', 'color', 'variant', 'disabled', 'loading', 'icon'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')">{{ label }}<slot /></button>',
  },
  UiTextInput: {
    props: ['modelValue', 'placeholder', 'disabled', 'fullWidth', 'size', 'mono', 'ui'],
    emits: ['update:modelValue', 'focus', 'keydown', 'blur'],
    template:
      '<input :value="modelValue" :placeholder="placeholder" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" @focus="$emit(\'focus\')" @keydown="$emit(\'keydown\', $event)" @blur="$emit(\'blur\')" />',
  },
  UiFormField: {
    props: ['label', 'error'],
    template:
      '<div><label v-if="label">{{ label }}</label><slot /><span v-if="error" class="error-msg">{{ error }}</span></div>',
  },
};

describe('UiEntityCreationModal', () => {
  it('renders when open', async () => {
    const component = await mountSuspended(UiEntityCreationModal, {
      props: { open: true, title: 'Create Folder' },
      global: { stubs },
    });

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('Create Folder');
  });

  it('shows default value in input when opened', async () => {
    const component = await mountSuspended(UiEntityCreationModal, {
      props: { open: true, title: 'Rename', defaultValue: 'my_file.txt' },
      global: { stubs },
    });

    expect(component.find('input').element.value).toBe('my_file.txt');
  });

  it('emits confirm with trimmed name', async () => {
    const component = await mountSuspended(UiEntityCreationModal, {
      props: { open: true, title: 'Create', defaultValue: 'test' },
      global: { stubs },
    });

    const buttons = component.findAll('button');
    const confirmButton = buttons.find((b) => b.text().includes('common.confirm'));
    if (confirmButton) {
      await confirmButton.trigger('click');
      expect(component.emitted('confirm')).toBeTruthy();
      expect(component.emitted('confirm')![0]).toEqual(['test']);
    }
  });

  it('does not emit confirm when name is empty', async () => {
    const component = await mountSuspended(UiEntityCreationModal, {
      props: { open: true, title: 'Create', defaultValue: '' },
      global: { stubs },
    });

    const buttons = component.findAll('button');
    const confirmButton = buttons.find((b) => b.text().includes('common.confirm'));
    if (confirmButton) {
      await confirmButton.trigger('click');
      expect(component.emitted('confirm')).toBeFalsy();
    }
  });

  it('emits cancel when cancel button is clicked', async () => {
    const component = await mountSuspended(UiEntityCreationModal, {
      props: { open: true, title: 'Create' },
      global: { stubs },
    });

    const buttons = component.findAll('button');
    const cancelButton = buttons.find((b) => b.text().includes('common.cancel'));
    if (cancelButton) {
      await cancelButton.trigger('click');
      expect(component.emitted('cancel')).toBeTruthy();
    }
  });

  it('shows validation error when validate returns false', async () => {
    const component = await mountSuspended(UiEntityCreationModal, {
      props: {
        open: true,
        title: 'Create',
        defaultValue: 'existing',
        validate: () => false,
      },
      global: { stubs },
    });

    await component.vm.$nextTick();
    expect(component.find('.error-msg').exists()).toBe(true);
  });

  it('shows validation error when validate returns string', async () => {
    const component = await mountSuspended(UiEntityCreationModal, {
      props: {
        open: true,
        title: 'Create',
        defaultValue: 'bad',
        validate: () => 'Invalid name',
      },
      global: { stubs },
    });

    await component.vm.$nextTick();
    expect(component.find('.error-msg').text()).toBe('Invalid name');
  });

  it('does not show error when validate returns true', async () => {
    const component = await mountSuspended(UiEntityCreationModal, {
      props: {
        open: true,
        title: 'Create',
        defaultValue: 'good',
        validate: () => true,
      },
      global: { stubs },
    });

    await component.vm.$nextTick();
    expect(component.find('.error-msg').exists()).toBe(false);
  });
});
