import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PresetSaveModal from '~/components/properties/PresetSaveModal.vue';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe('PresetSaveModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders title, input field, and action buttons when open', () => {
    const wrapper = mount(PresetSaveModal, {
      props: {
        open: true,
        name: 'My Custom Preset',
      },
      global: {
        stubs: {
          UiModal: {
            template: '<div><slot /><slot name="footer" /></div>',
          },
          UiFormField: {
            template: '<div><slot /></div>',
          },
          UiTextInput: {
            props: ['modelValue'],
            template:
              '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
          UButton: {
            props: ['disabled'],
            template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          },
        },
      },
    });

    expect(wrapper.find('input').element.value).toBe('My Custom Preset');
    expect(wrapper.findAll('button')).toHaveLength(2);
  });

  it('emits save event on primary button click', async () => {
    const wrapper = mount(PresetSaveModal, {
      props: {
        open: true,
        name: 'New Effect Preset',
      },
      global: {
        stubs: {
          UiModal: {
            template: '<div><slot /><slot name="footer" /></div>',
          },
          UiFormField: {
            template: '<div><slot /></div>',
          },
          UiTextInput: {
            props: ['modelValue'],
            template: '<input :value="modelValue" />',
          },
          UButton: {
            props: ['disabled'],
            template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          },
        },
      },
    });

    const buttons = wrapper.findAll('button');
    const saveBtn = buttons[1];
    await saveBtn.trigger('click');

    expect(wrapper.emitted('save')).toBeTruthy();
  });
});
